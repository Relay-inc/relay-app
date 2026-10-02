import { isImg } from "../../../shared/icons";
import type { ProjectIcon as Icon } from "../../../domain/workspace/types";
import { Icon as AppIcon } from "../../components/Icon";
import { ProjectImg } from "../../components/ProjectImg";
import { TILE } from "./blocks";

/** A project's icon as it shows in a row (`row`) or on the tile beside its field (`tile`). */
export function ProjectIcon({ icon, where }: { icon: Icon | undefined; where: "row" | "tile" }) {
  if (isImg(icon?.img)) return <ProjectImg url={icon.img} className="size-4 rounded-sm" />;
  if (icon?.icon)
    return (
      <span className={`w-4 flex-none text-center leading-none ${where === "row" ? "text-base" : "text-sm"}`}>
        {icon.icon}
      </span>
    );
  return <AppIcon name="folder" className={where === "row" ? TILE : "size-4 fill-none stroke-s-subtle stroke-2"} />;
}
