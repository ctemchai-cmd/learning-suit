import { describe, expect, it } from "vitest";
import { favoriteForKey, moveFavorite } from "./favorites";
import type { EditorTool } from "./store";

const order: EditorTool[] = ["select", "pen", "rectangle", "ellipse", "arrow", "text"];

describe("favorite tools", () => {
  it("moves one tool to a new place, clamped to the ends", () => {
    expect(moveFavorite(order, "text", 0)).toEqual(["text", "select", "pen", "rectangle", "ellipse", "arrow"]);
    expect(moveFavorite(order, "select", 2)).toEqual(["pen", "rectangle", "select", "ellipse", "arrow", "text"]);
    expect(moveFavorite(order, "pen", -3)).toEqual(["pen", "select", "rectangle", "ellipse", "arrow", "text"]);
    expect(moveFavorite(order, "pen", 99)).toEqual(["select", "rectangle", "ellipse", "arrow", "text", "pen"]);
  });

  it("maps keys 1–8 to the toolbar order", () => {
    expect(favoriteForKey(order, 1)).toBe("select");
    expect(favoriteForKey(order, 6)).toBe("text");
    expect(favoriteForKey(order, 7)).toBeNull();
    expect(favoriteForKey([...order, "eraser", "line", "laser"], 9)).toBeNull();
  });
});
