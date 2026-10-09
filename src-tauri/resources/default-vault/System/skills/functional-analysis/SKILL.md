---
name: functional-analysis
description: "Write a complete functional analysis for a new feature or a change to an existing process: how it works today, how it must work tomorrow, the cases, the hard acceptance criteria, and what ships by when. Use whenever something is asked of a development team ('write a functional analysis', 'spec this feature', 'write this up for the developers', 'what do we need to specify before building X') and to review an existing analysis for gaps ('check this spec', 'what is missing here')."
---

# Functional analysis

The document that lets a developer build a feature without calling back, and lets the requester check the result themselves after delivery.

It is done when a colleague who does not know the case can read it and know exactly what must happen in every situation, not only the one the request is about.

## Before you start

Read the project note and its `Documents/` for systems, standing exceptions, vocabulary and known pitfalls. Use them to ask sharper questions, never to fill in answers. If the requester says something different from the notes, the requester wins and the difference becomes an open question.

## Method

Follow the seven steps in order. Skip none, also when the request looks small. Small requests with open cases become expensive requests.

### 1. Collect first, write after

Ask until you have the answers below. Never fill in what the requester did not say. If something is unknown, write it as an open question. An open question in the analysis is good. An invented answer is a bug someone pays for later.

Minimum needed:

1. The problem in plain language, and how often it happens (count per week or month, or an estimate marked as an estimate)
2. At least one real example from practice, with a record number, customer name or invoice number
3. Who does the work today, and in which screen or system
4. What happens if nothing is done
5. The desired delivery date, and why that date exists (an audit, a customer promise, a season, a financial close)

### 2. Describe how it works today

Write the current situation as numbered steps in the order they really happen. Each step says who does something, where, and the result.

Put the real example from step 1 under the steps, with the real values. Not "a record" but "record 1042".

Also write down what happens manually or outside the system today: a spreadsheet, a mail to a colleague, a note on paper. That is where the errors live and what the developer needs most.

### 3. Describe how it must work tomorrow

Same structure and numbering as step 2, so the two read side by side. Mark each step as unchanged, changed, removed or new.

For each new screen or field say:
- What it is called
- What the user sees
- What happens after the click or the save
- What the user sees on success, and on failure

Describe behavior, not technique. "The system shows the customer's open orders, newest first" is a good sentence. "The system queries the table" is not.

### 4. Pin down the rules

Put every decision the system must take in a table with two columns: the situation, and what the system does. One rule per row, no compound sentences.

Every rule that uses an amount, a term, a percentage or a date gets the exact number. Not "shortly after" but "within 15 minutes". Not "a small margin" but "up to 80 per hour".

### 5. Complete the case grid

This is what makes the analysis complete. Go through the ten questions below and answer each one explicitly in the case table. Also when the answer is "cannot occur here", write that with the reason. An empty cell means nobody thought about it, and then the developer decides in your place.

| # | Question | Why it matters |
|---|---|---|
| 1 | Who may do this, and who may not see it? | Permissions are rarely asked for and always needed afterwards. |
| 2 | What happens to the records and data that already exist? | New rules touch old data. Do they move along, stay as they are, or need a one-off fix? |
| 3 | What if a required value is missing or empty? | Block, or continue with a warning? Pick one. |
| 4 | What if it happens twice? | Double click, a second import, a colleague doing the same thing at the same time. One result or two? |
| 5 | What if someone changes or reverses it afterwards? | A cancelled record, a changed amount, a status going back. |
| 6 | What if an external system does not answer? | Accounting, CRM, mail, payments. Does work continue or wait? Who sees that it failed? |
| 7 | Are there customer or record types with their own rule? | Name all of them, also the ones where nothing changes. |
| 8 | What does the customer or end user see of this? | A mail, a document, an amount on an invoice. If the answer is "nothing", write that. |
| 9 | What must be traceable afterwards? | Who did what and when. Needed for disputes and bookkeeping. |
| 10 | What must not break? | Name the existing functions close to this change that must keep working as they are. |

Also ask about any known pitfalls listed in the project notes. Each yes becomes an extra case.

The case table starts with the normal course of events, then questions 1 to 9 in that order. Question 10 gets its own section ("What must not break"), with per function how it is checked.

Cases go in a table with four columns: ID, situation, what the system must do, and how the requester can check it. Give every case a short ID (for example BOOK-01, BOOK-02) so tickets, mails and test rounds can refer to it.

### 6. Write the acceptance criteria

Three to seven sentences that are true or false after delivery, without discussion. This is the agreement. What is not in here is not promised.

A good criterion is measurable and contains a number or a name. A bad one contains "correct", "smooth", "user-friendly" or "as discussed".

- Good: "An invoice for a record with two booked deposits shows both deposits deducted, and the total is right to the cent."
- Bad: "The invoice is correct."

### 7. Set scope and deadline

Two lists, both filled in:

- **Must ship in this delivery**, with the date and the reason that date is fixed
- **Can come later**, with per item the reason it can wait

Anything in neither list is not requested and not built. That is fine, as long as it is deliberate.

## Quality gate before sending

Run these seven checks. One no means the analysis is not ready to send.

1. Is there at least one real example with real numbers?
2. Does every case in the table have a filled-in expectation? No empty rows or question marks?
3. Are all ten questions of the case grid answered, including the "not applicable" ones, and were the known pitfalls asked?
4. Does every acceptance criterion contain something you can check on screen?
5. Does every amount, term and percentage have an exact number?
6. Is there a delivery date with a reason?
7. Are the open questions listed apart, so they are not read as decisions?

Report the result of the gate at the bottom of the document or in the reply to the requester. Do not hide a no, and do not fill in a missing answer yourself to turn the gate green.

## Files

- `template.md`: the empty document, ready to fill in
- `example.md`: a short worked analysis (fictional), as a yardstick for the level of detail

## Writing rules

- Short sentences, plain words. Jargon only when the business uses it.
- No em-dashes and no semicolons. Use a comma, a period or parentheses.
- Present tense: "the system shows", not "the system will show".
- Never invent a number, a date, a name or a record number. What you do not know becomes an open question.
