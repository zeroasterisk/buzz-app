// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { A2uiSurface, type ReactCatalogComponent } from "@a2ui/react";
import type { SurfaceModel } from "@a2ui/web_core";
import { BASIC_COMPONENTS } from "@a2ui/web_core/catalogs/basic/v1";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { A2uiThreadStore } from "./a2uiThread";
import { buzzBasicCatalog } from "./catalog";

afterEach(cleanup);

const FORM = `surface("triage")
title = Text("Flaky test triage")
note = Text("Pick one", variant="caption")
pick = ChoicePicker(label="Next step", options=[{label: "Retry", value: "retry"}, {label: "Revert", value: "revert"}], value=$/choice, variant="mutuallyExclusive")
why = TextField(label="Why", value=$/why)
ok = CheckBox(label="Notify owner", value=$/notify)
go = Button(Text("Apply"), variant="primary", action=Event("apply", {choice: $/choice, why: $/why}))
root = Card(Column([title, note, pick, why, ok, go]))
$/choice = ["retry"]
$/why = ""
$/notify = false`;

function mount(source: string) {
  const store = new A2uiThreadStore<ReactCatalogComponent>(buzzBasicCatalog);
  const sent: string[] = [];
  store.setSendMessage(async (text) => {
    sent.push(text);
  });
  store.sync([{ key: "m1:0", source }]);
  const result = store.result("m1:0");
  if (!result?.ok) throw new Error(result?.error ?? "no result");
  const surface = store.surface(result.surfaceIds[0] ?? "") as
    | SurfaceModel<ReactCatalogComponent>
    | undefined;
  if (!surface) throw new Error("no surface");
  render(<A2uiSurface surface={surface} />);
  return sent;
}

it("implements every basic catalog component, so Express output validates as-is", () => {
  expect([...buzzBasicCatalog.components.keys()].sort()).toEqual(
    BASIC_COMPONENTS.map((api) => api.name).sort(),
  );
});

it("draws a triage form with native, labelled controls", () => {
  mount(FORM);
  expect(screen.getByText("Flaky test triage")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Retry" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Revert" })).not.toBeChecked();
  expect(screen.getByRole("textbox", { name: "Why" })).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "Notify owner" }),
  ).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
  expect(document.querySelector("iframe")).toBeNull();
});

it("sends the edited values with the action", async () => {
  const user = userEvent.setup();
  const sent = mount(FORM);
  await user.click(screen.getByRole("radio", { name: "Revert" }));
  await user.type(screen.getByRole("textbox", { name: "Why" }), "flaky");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await expect.poll(() => sent.length).toBe(1);
  const payload = JSON.parse(
    /```a2ui-action\n(.*)\n```/.exec(sent[0] ?? "")?.[1] ?? "{}",
  );
  expect(payload).toMatchObject({
    surfaceId: "triage",
    name: "apply",
    context: { choice: ["revert"], why: "flaky" },
  });
});

it("shows a visible placeholder for catalog components Buzz does not draw yet", () => {
  mount(
    `root = Column([Text("before"), Slider(label="Size", min=0, max=10, value=$/n)])\n$/n = 3`,
  );
  expect(screen.getByText("before")).toBeInTheDocument();
  expect(screen.getByText("Unsupported: Slider")).toBeInTheDocument();
});
