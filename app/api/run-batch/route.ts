import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium";
import { chromium as pw, type Page } from "playwright-core";
import { ELEMENT_WAIT_MS, EMAIL_PATTERN } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const XP = {
  email: process.env.EMAIL_XPATH ?? '//*[@id="Email"]',
  register: process.env.REGISTER_BUTTON_XPATH ?? '//*[@id="registerBtn"]',
  clickHere:
    process.env.CLICK_HERE_XPATH ??
    '//*[@id="registerForm"]/div[2]/div[23]/span[2]/a | //*[@id="registerForm"]/div[2]/div[14]/span[2]/a | //*[@id="registerForm"]/div[2]/div[16]/span[2]/a | //*[@id="registerForm"]/div[2]/div[2]/span[2]/a',
  popupClose: process.env.POPUP_CLOSE_XPATH ?? '//*[@id="SuccessPopupArea"]/div/div/div[1]/button/span',
};

type Result = { email: string; status: "Success" | "Fail" | "Pending"; error: string };

const loc = (page: Page, xpath: string) => page.locator(`xpath=${xpath}`).first();

async function click(page: Page, xpath: string) {
  const el = loc(page, xpath);
  try {
    await el.click({ timeout: ELEMENT_WAIT_MS });
  } catch (err) {
    if ((err as Error).name === "TimeoutError" && (await el.count()) === 0) throw err;
    await el.evaluate((n) => (n as HTMLElement).click(), undefined, { timeout: ELEMENT_WAIT_MS });
  }
}

async function runOne(page: Page, email: string): Promise<Result> {
  try {
    const field = loc(page, XP.email);
    await field.waitFor({ state: "visible", timeout: ELEMENT_WAIT_MS });
    await field.fill("");
    await field.fill(email);
    await click(page, XP.register);
    await click(page, XP.clickHere);
    await click(page, XP.popupClose);
    return { email, status: "Success", error: "" };
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError") {
      return { email, status: "Fail", error: `Timeout waiting for required page element: ${e.message.split("\n")[0]}` };
    }
    return { email, status: "Pending", error: `Browser error: ${e.message.split("\n")[0]}` };
  }
}

export async function POST(req: NextRequest) {
  let body: { url?: string; emails?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }

  let target: URL;
  try { target = new URL(String(body.url ?? "").trim()); } catch {
    return NextResponse.json({ error: "Enter a valid http(s) URL." }, { status: 400 });
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    return NextResponse.json({ error: "Enter a valid http(s) URL." }, { status: 400 });
  }
  const emails = (body.emails ?? []).filter((e) => EMAIL_PATTERN.test(e)).slice(0, 5);
  if (emails.length === 0) return NextResponse.json({ results: [] });

  const local = !!process.env.CHROME_EXECUTABLE_PATH;
  let browser;
  try {
    browser = await pw.launch({
      args: local ? [] : chromium.args,
      executablePath: process.env.CHROME_EXECUTABLE_PATH || (await chromium.executablePath()),
      headless: true,
    });
    const page = await (await browser.newContext()).newPage();
    await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    const results: Result[] = [];
    for (const email of emails) {
      const r = await runOne(page, email);
      results.push(r);
      if (r.status !== "Success") {
        // Reload so the next email starts from a clean form.
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
      }
    }
    return NextResponse.json({ results });
  } catch (err) {
    const msg = `Browser error: ${(err as Error).message.split("\n")[0]}`;
    return NextResponse.json({ results: emails.map((email) => ({ email, status: "Pending", error: msg })) });
  } finally {
    await browser?.close().catch(() => {});
  }
}
