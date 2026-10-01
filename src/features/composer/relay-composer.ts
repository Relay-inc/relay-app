import { LitElement, html, css, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { t } from "../../core/i18n";
import { icon } from "../../core/icons";
import { StoreController } from "../../core/store";
import { tw } from "../../core/styles";
import { ui, isTerminal } from "../../domain/ui";
import { chat, terminalOf, projectOf } from "../../domain/chats/state";
import { project } from "../../domain/vault";
import { chatAgent, agentOf, onAgents, picks, setPick, commands } from "../../domain/agents";
import { matchCommands, type SlashCommand } from "../../domain/commands";
import { setTyped, sendMsg, sendOrStop, attach, unattach, setAgent } from "../../domain/chats/actions";
import { zoom } from "../../domain/navigation";
import { pastedImages, hasFiles } from "../../components/image-files";
import "../../components/image-thumbs";

type Pick = { id: string; label: string };

/** The message field with the images waiting, the agent, model and effort picks and the send button. */
@customElement("relay-composer")
export class RelayComposer extends LitElement {
  // the field and the picks drop the browser's look entirely (`all:unset`), which a utility can't say
  static override styles = [
    tw,
    css`
      :host {
        display: block;
        flex: none;
      }
      textarea {
        all: unset;
        display: block;
        width: 100%;
        min-height: 24px;
        font-size: 15px;
        line-height: 1.5;
        color: var(--label);
      }
      textarea::placeholder {
        color: var(--secondary);
      }
      select {
        all: unset;
        font-size: 12px;
        color: var(--secondary);
        height: 26px;
        padding: 0 20px 0 8px;
        border-radius: 7px;
        cursor: default;
      }
      select:hover:not(:disabled) {
        background: var(--fill-2);
        color: var(--label);
      }
      select:disabled {
        opacity: 0.5;
      }
    `,
  ];
  protected store = new StoreController(this);
  @state() private dropping = false;
  @state() private picked = 0;
  // the text Escape closed the list on: it stays closed until the text changes
  @state() private dismissed = "";
  @query("textarea") private field!: HTMLTextAreaElement | null;
  @query("input[type=file]") private files!: HTMLInputElement | null;
  private grown = "";

  focusInput() {
    if (this.field) this.field.focus();
    else this.updateComplete.then(() => this.field?.focus());
  }
  private grow() {
    const field = this.field;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = field.scrollHeight + "px";
    this.grown = field.value;
  }
  // switching to another conversation puts other text in the field
  override updated() {
    if (this.field && this.field.value !== this.grown) this.grow();
  }

  // Claude Code's slash commands and skills while the field is a `/` and a name
  private get completions() {
    const typed = chat.typed[ui.selected] ?? "";
    if (chatAgent(ui.selected) !== "claude" || typed === this.dismissed) return [];
    return matchCommands(commands.list, typed);
  }
  private complete(command: SlashCommand) {
    setTyped(`/${command.name} `);
    this.picked = 0;
    this.focusInput();
  }
  // arrows move through the list, Tab or Enter takes one, Escape closes it
  private onCompletionKey(e: KeyboardEvent) {
    const list = this.completions;
    if (!list.length || e.isComposing) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const step = e.key === "ArrowDown" ? 1 : -1;
      this.picked = (this.picked + step + list.length) % list.length;
    } else if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
      this.complete(list[Math.min(this.picked, list.length - 1)]);
    } else if (e.key === "Escape") {
      this.dismissed = chat.typed[ui.selected] ?? "";
    } else return false;
    e.preventDefault();
    return true;
  }

  private onKey(e: KeyboardEvent) {
    if (this.onCompletionKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMsg();
    }
  }
  private onInput(e: Event) {
    setTyped((e.target as HTMLTextAreaElement).value);
    this.picked = 0;
    this.grow();
  }
  private onPaste(e: ClipboardEvent) {
    const files = pastedImages(e);
    if (files.length) attach(files);
  }
  private onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    this.dropping = true;
  }
  private onDragLeave() {
    this.dropping = false;
  }
  private onDrop(e: DragEvent) {
    this.dropping = false;
    if (!hasFiles(e)) return;
    e.preventDefault();
    attach([...e.dataTransfer!.files]);
  }
  private onRemoveImage(e: CustomEvent<number>) {
    unattach(e.detail);
    this.focusInput();
  }

  private get terminalSession() {
    return isTerminal(ui.selected) ? terminalOf(ui.selected) : undefined;
  }
  private get projectName() {
    return this.terminalSession ? this.terminalSession.project : projectOf(ui.selected);
  }
  private get busy() {
    return chat.status[ui.selected] === "busy";
  }
  private get placeholder() {
    const projectName = this.projectName;
    if (this.terminalSession) return t("ph.term");
    return project(projectName) ? t("ph.project", { name: projectName ?? "" }) : t("ph.general");
  }

  private renderCompletions() {
    const list = this.completions;
    if (!list.length) return nothing;
    const picked = Math.min(this.picked, list.length - 1);
    return html`<ul
      class="absolute bottom-full inset-x-0 mb-1.5 py-1 rounded-lg bg-bg border border-separator shadow-md overflow-hidden"
      role="listbox"
      aria-label=${t("composer.commands")}
    >
      ${list.map(
        (command, i) =>
          html`<li
            class="flex items-baseline gap-2 px-3 py-1.5 text-sm cursor-default ${i === picked ? "bg-fill" : ""}"
            role="option"
            aria-selected=${i === picked}
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${() => this.complete(command)}
            @mouseenter=${() => (this.picked = i)}
          >
            <span class="font-medium whitespace-nowrap">/${command.name}</span>
            ${command.argumentHint ? html`<span class="text-secondary whitespace-nowrap">${command.argumentHint}</span>` : nothing}
            <span class="text-secondary truncate">${command.description}</span>
          </li>`,
      )}
    </ul>`;
  }

  private renderThumbs() {
    if (!chat.attached.length) return nothing;
    return html`<relay-image-thumbs
      class="mb-2"
      removable
      .urls=${chat.attached.map(image => image.url)}
      @remove=${this.onRemoveImage}
      @open=${(e: CustomEvent<string>) => zoom(e.detail)}
    ></relay-image-thumbs>`;
  }

  // the agent is fixed once a conversation has a message, and the sidebar shows it then; with one agent there is nothing to pick
  private renderAgentPick() {
    const agents = onAgents();
    const selected = ui.selected;
    if (agents.length <= 1 || isTerminal(selected) || !chat.chats[selected]) return nothing;
    const started = !!(chat.messages[selected] || []).length || !!chat.chats[selected]?.fork;
    if (started) return nothing;
    const agentId = chatAgent(selected);
    return html`<span class="relative inline-flex items-center rounded-[7px] bg-fill-2 text-label"
        ><select
          class="text-label!"
          title=${t("composer.agent")}
          aria-label=${t("composer.agent")}
          @change=${(e: Event) => setAgent((e.target as HTMLSelectElement).value)}
        >
          ${agents.map(agent => html`<option value=${agent.id} .selected=${agent.id === agentId}>${agent.name}</option>`)}
        </select>
        ${this.chevron()}</span
      ><span class="w-px h-3.5 bg-separator-strong mx-1"></span>`;
  }

  private chevron() {
    return html`<span class="absolute right-1.5 pointer-events-none text-secondary"
      >${icon("down", "glyph size-2.75 stroke-2")}</span
    >`;
  }

  private renderPick(kind: "model" | "effort", options: Pick[], value: string, defaultLabel: string, show: boolean) {
    return html`<span class="relative items-center ${show ? "inline-flex" : "hidden"}"
      ><select
        ?disabled=${this.busy}
        title=${t(`composer.${kind}`)}
        aria-label=${t(`composer.${kind}`)}
        @change=${(e: Event) => setPick(kind, (e.target as HTMLSelectElement).value)}
      >
        <option value="" .selected=${value === ""}>${defaultLabel}</option>
        ${options.map(option => html`<option value=${option.id} .selected=${option.id === value}>${option.label}</option>`)}
      </select>
      ${this.chevron()}</span
    >`;
  }

  // the + opens the file dialog for images; they join the ones pasted or dropped
  private renderAttach() {
    return html`<button
        class="grid place-items-center size-7 rounded-[7px] border-0 bg-transparent text-secondary hover:bg-fill-2 hover:text-label"
        title=${t("composer.attach")}
        aria-label=${t("composer.attach")}
        @click=${() => this.files?.click()}
      >
        ${icon("add", "glyph size-4")}
      </button>
      <input
        type="file"
        accept="image/*"
        multiple
        hidden
        @change=${(e: Event) => {
          const input = e.target as HTMLInputElement;
          attach([...(input.files ?? [])]);
          input.value = "";
        }}
      />`;
  }

  private renderSendButton() {
    const busy = this.busy;
    const colour = busy ? "bg-label" : "bg-accent hover:bg-accent-hover";
    return html`<button
      class="grid place-items-center size-7 rounded-full border-0 ${colour} text-on-accent"
      aria-label=${t("composer.send")}
      @click=${sendOrStop}
    >
      ${icon(busy ? "stop" : "send", "glyph size-3.75 stroke-2")}
    </button>`;
  }

  override render() {
    const agent = agentOf(chatAgent(ui.selected));
    const model = picks("model");
    const effort = picks("effort");
    const showEffort = !agent || (agent.caps.effort && agent.efforts.length > 0);
    const border = this.dropping ? "border-accent" : "border-separator-strong";
    return html`<div
      class="relative rounded-[14px] bg-raised border pt-3 pr-3 pb-2 pl-3.5 shadow-md focus-within:border-accent ${border}"
      @dragover=${this.onDragOver}
      @dragleave=${this.onDragLeave}
      @drop=${this.onDrop}
    >
      ${this.renderCompletions()} ${this.renderThumbs()}
      <textarea
        rows="1"
        .value=${live(chat.typed[ui.selected] ?? "")}
        placeholder=${this.placeholder}
        @keydown=${this.onKey}
        @input=${this.onInput}
        @paste=${this.onPaste}
      ></textarea>
      <div class="flex items-center gap-0.5 mt-2 -ml-1.5 text-secondary">
        ${this.renderAttach()} ${this.renderAgentPick()}
        <!-- a switch restarts the process, so not while a turn runs -->
        ${this.renderPick("model", model.list, model.value, t("composer.defaultModel"), true)}
        ${this.renderPick("effort", effort.list, effort.value, t("composer.defaultEffort"), showEffort)}
        <span class="flex-1"></span>
        ${this.renderSendButton()}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "relay-composer": RelayComposer;
  }
}
