import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";

test.use({
  productionBroker: true,
  enabledPlugins: ["buzz.a2ui"],
  historyCounts: { alpha: 1, beta: 1 },
});

const FORM = `The flaky test failed 3 of the last 10 runs. Pick a next step.

<a2ui>
surface("triage")
title = Text("Flaky test triage")
pick = ChoicePicker(label="Next step", options=[{label: "Retry", value: "retry"}, {label: "Revert", value: "revert"}, {label: "Quarantine", value: "quarantine"}], value=$/choice, variant="mutuallyExclusive")
note = TextField(label="Note for the team", value=$/note)
go = Button(Text("Apply"), variant="primary", action=Event("apply", {choice: $/choice, note: $/note}))
root = Card(Column([title, pick, note, go]))
$/choice = ["retry"]
$/note = ""
</a2ui>`;

const UPDATE = `Quarantined. Anything else?

<a2ui>
surface("triage", update=true)
title = Text("Quarantined: flaky-login")
pick = ChoicePicker(label="Next step", options=[{label: "Keep quarantined", value: "keep"}, {label: "Release", value: "release"}], value=$/choice, variant="mutuallyExclusive")
go = Button(Text("Apply"), variant="primary", action=Event("apply", {choice: $/choice}))
root = Card(Column([title, pick, go]))
$/choice = ["keep"]
</a2ui>`;

const SHOTS = process.env.A2UI_CUJ_DIR;

// Slice 2.5: the full agent -> person -> agent round trip through the production
// broker and the modeled relay (docker/`just relay` cannot run in this sandbox).
for (const [width, theme] of [
  [1100, "light"],
  [412, "dark"],
]) {
  test(`live round trip: form, edited Apply reaches the agent, update supersedes (${width} ${theme})`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height: width > 500 ? 900 : 915 });
    await page.emulateMedia({ colorScheme: theme });
    let n = 0;
    const shot = async (label) => {
      if (!SHOTS) return;
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      await page.screenshot({
        path: `${SHOTS}/${width}-${String(n++).padStart(2, "0")}-${label}.png`,
      });
    };
    const key = generateSecretKey();
    const agent = getPublicKey(key);
    app.serveProfile(key, { name: "Triage agent", is_agent: true });
    // A posting agent is a channel member; the action reply p-tags it, and the
    // host refuses mentions of non-members.
    app.serveMembers("alpha", [agent]);
    await page.route("**/agent-library", (route) =>
      route.fulfill({
        json: {
          definitions: [],
          identities: [{ pubkey: agent, name: "Triage agent" }],
        },
      }),
    );
    const history = app.histories.get("primary/alpha");
    const post = (content, tags) => {
      const event = finalizeEvent(
        {
          kind: 9,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["h", "alpha"], ...tags],
          content,
        },
        key,
      );
      history.push(event);
      app.relay.publish("primary", event);
      return event;
    };
    const errors = app.watchPageErrors(page);
    await open(page, app);

    // Agent turn 1: the triage form, top level.
    const turn1 = post(FORM, []);
    const row1 = page.locator(`[data-message-id="${turn1.id}"]`);
    await expect(row1.getByText("Flaky test triage")).toBeVisible({
      timeout: 60000,
    });
    await row1.scrollIntoViewIfNeeded();
    await shot("form");

    // The person edits and applies.
    await row1.getByRole("radio", { name: "Quarantine" }).click();
    await row1
      .getByRole("textbox", { name: "Note for the team" })
      .fill("Quarantining until #415 lands");
    await shot("edited");
    const before = app.report.publications.length;
    await row1.getByRole("button", { name: "Apply" }).click();
    await expect(row1.getByText("Sent to the agent")).toBeVisible();
    await shot("sent");

    // The agent sees the action reply: in the thread, p-tagged, edited context.
    await expect
      .poll(() => app.report.publications.length)
      .toBeGreaterThan(before);
    const action = app.report.publications.at(-1).event;
    expect(action.tags).toContainEqual(["p", agent]);
    expect(action.tags).toContainEqual(["e", turn1.id, "", "reply"]);
    const payload = JSON.parse(
      action.content.match(/```a2ui-action\n(.*)\n```/s)[1],
    );
    expect(payload).toMatchObject({
      surfaceId: "triage",
      name: "apply",
      context: {
        choice: ["quarantine"],
        note: "Quarantining until #415 lands",
      },
    });

    // Agent turn 2: update the same surface in the thread.
    post(UPDATE, [["e", turn1.id, "", "reply"]]);
    await expect(row1.getByText("Updated below")).toBeVisible({
      timeout: 30000,
    });
    await shot("superseded");
    await row1.getByRole("button", { name: /^View thread/ }).click();
    const panel = page.getByRole("complementary", {
      name: "Thread",
      exact: true,
    });
    await expect(panel.getByText("Quarantined: flaky-login")).toBeVisible({
      timeout: 30000,
    });
    // Unlocked: the updated surface takes input again. The narrow thread can still
    // be laying out its rows, so retry the click until the choice lands.
    const release = panel.getByRole("radio", { name: "Release" });
    await expect(async () => {
      await release.click();
      await expect(
        panel.locator('[role="radio"][aria-checked="true"]'),
      ).toHaveAccessibleName("Release", { timeout: 1000 });
    }).toPass({ timeout: 15000 });
    await shot("updated");

    await expect(page.locator("iframe")).toHaveCount(0);
    // Exactly one live surface for `triage` across channel + thread views.
    const triageTitles = page.locator("[data-a2ui-surface]", {
      hasText: /triage|Quarantined/,
    });
    await expect(triageTitles).toHaveCount(1);
    await expect(page.locator("[data-a2ui-locked]")).toHaveCount(0);
    expect(errors.unexplained()).toEqual([]);
  });
}
