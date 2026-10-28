import { expect, test } from "@playwright/test";

test("dashboard loads collections", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("drivers")).toBeVisible();
});

test("collections page and document CRUD", async ({ page }) => {
  await page.goto("/collections");
  await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();
  await page.click('button:has-text("Open drivers")');
  await expect(page.getByRole("heading", { name: "drivers" })).toBeVisible();

  await page.click('button:has-text("New document")');
  const dialog = page.getByRole("dialog");
  await dialog.locator("textarea").fill('{ "name": "E2E Probe", "status": "active" }');
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("E2E Probe")).toBeVisible();

  await page.getByRole("button", { name: /Edit/ }).first().click();
  const editDialog = page.getByRole("dialog");
  await editDialog.locator("textarea").fill('{ "name": "E2E Edited", "status": "active" }');
  await editDialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("E2E Edited")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
});

test("query lab and migrations", async ({ page }) => {
  await page.goto("/query");
  await expect(page.getByRole("heading", { name: "Query lab" })).toBeVisible();
  await page.getByRole("button", { name: "Explain" }).click();
  await expect(page.getByText(/Keys examined/)).toBeVisible();

  await page.goto("/migrations");
  await expect(page.getByRole("heading", { name: "Migrations" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("20260101000000").first()).toBeVisible();
});
