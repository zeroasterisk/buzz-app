import { watchPageErrors } from "./page-errors.mjs";
import { test, expect } from "./source-fixture.mjs";

const gallery = "/tests/fixtures/message-gallery.html?group=a2ui";
const row = (page, id) => page.locator(`[data-message-id="${id}"]`);
const overflows = (node) =>
  node.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
// The first painted ancestor of the field: the reply card.
const fieldAndCard = (form) =>
  form.getByRole("textbox", { name: "Note for the team" }).evaluate((e) => {
    let n = e.parentElement;
    while (n && getComputedStyle(n).backgroundColor === "rgba(0, 0, 0, 0)")
      n = n.parentElement;
    return {
      field: getComputedStyle(e).backgroundColor,
      card: n ? getComputedStyle(n).backgroundColor : null,
    };
  });

// Real roles, layout and theme tokens need a browser; parsing, trust and the
// action reply stay in Vitest (A2uiMessage.test.tsx).
test("an agent reply draws native controls; other rows never become live UI", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(gallery);
  const form = row(page, "a2ui-form");
  await expect(form.getByText("Flaky test triage")).toBeVisible();
  await expect(form.getByRole("radio")).toHaveCount(3);
  await expect(form.getByRole("radio", { name: "Retry" })).toBeChecked();
  await expect(
    form.getByRole("textbox", { name: "Note for the team" }),
  ).toBeVisible();
  await expect(
    form.getByRole("checkbox", { name: "Tell #release" }),
  ).toBeVisible();
  await expect(form.getByRole("button", { name: "Apply" })).toHaveCount(1);

  const human = row(page, "a2ui-human");
  await expect(human).toContainText("ChoicePicker");
  await expect(
    human.locator('input, textarea, [role="radio"], [role="checkbox"]'),
  ).toHaveCount(0);
  await expect(human.getByRole("button", { name: "Apply" })).toHaveCount(0);

  const streaming = row(page, "a2ui-streaming");
  await expect(streaming.locator("[data-a2ui-pending]")).toHaveCount(1);
  await expect(streaming).not.toContainText("surface(");

  const blocked = row(page, "a2ui-blocked");
  await expect(blocked).toContainText(/blocked/i);
  await expect(blocked).toContainText("Iframe(");
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(errors.unexplained()).toEqual([]);
});

test("the reply stays inside a narrow column and at 1.5x text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(gallery);
  await page.getByRole("button", { name: "Narrow preview" }).click();
  // Inline: the host's own `html` font-size rule outranks an added style tag.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "150%";
  });
  const form = row(page, "a2ui-form");
  const apply = form.getByRole("button", { name: "Apply" });
  await expect(apply).toBeVisible();
  for (const control of [
    form.getByRole("radio", { name: "Quarantine" }),
    form.getByRole("textbox", { name: "Note for the team" }),
    apply,
  ]) {
    const box = await control.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  }
  expect(await overflows(form)).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("long labels and a wide row wrap inside a narrow column at 1.5x text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(gallery);
  await page.getByRole("button", { name: "Narrow preview" }).click();
  // Inline: the host's own `html` font-size rule outranks an added style tag.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "150%";
  });
  const wide = row(page, "a2ui-wide");
  await expect(wide.getByRole("button", { name: "Open logs" })).toBeVisible();
  for (const button of await wide.locator("[data-a2ui-surface] button").all()) {
    const box = await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(await overflows(button)).toBe(false);
  }
  const surface = wide.locator("[data-a2ui-surface]");
  expect(
    await surface.evaluate((s) =>
      [s, ...s.querySelectorAll("*")].some(
        (n) => n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1,
      ),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Apply locks the reply visibly and keeps the chosen values", async ({
  page,
}) => {
  await page.goto(gallery);
  const form = row(page, "a2ui-form");
  await form.getByRole("radio", { name: "Quarantine" }).click();
  const note = form.getByRole("textbox", { name: "Note for the team" });
  await note.fill("Quarantining until #415 lands");
  await form.getByRole("button", { name: "Apply" }).click();
  await expect(form.getByText("Sent to the agent")).toBeVisible();
  const locked = form.locator("[data-a2ui-locked]");
  await expect(locked).toHaveAttribute("inert", "");
  expect(
    Number(await locked.evaluate((e) => getComputedStyle(e).opacity)),
  ).toBeLessThan(1);
  await expect(
    form.locator('[role="radio"][aria-checked="true"]'),
  ).toHaveAccessibleName("Quarantine");
  await expect(note).toHaveValue("Quarantining until #415 lands");
});

test("the reply follows the theme tokens and the field stands off the card", async ({
  page,
}) => {
  await page.goto(gallery);
  const form = row(page, "a2ui-form");
  await expect(form.getByRole("button", { name: "Apply" })).toBeVisible();
  const light = await fieldAndCard(form);
  expect(light.field).not.toBe(light.card);
  await page.evaluate(() => {
    document.documentElement.dataset.colorMode = "dark";
  });
  await expect.poll(() => fieldAndCard(form)).not.toEqual(light);
  const dark = await fieldAndCard(form);
  expect(dark.field).not.toBe(dark.card);
});
