import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const distDir = resolve(appDir, "dist");

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

execSync("pnpm exec tsc -p tsconfig.json", {
  cwd: appDir,
  stdio: "inherit"
});

mkdirSync(distDir, { recursive: true });

for (const file of ["manifest.json", "popup.html", "popup.css", "README.md"]) {
  cpSync(resolve(appDir, file), resolve(distDir, file));
}

const popupHtmlPath = resolve(distDir, "popup.html");
const popupHtml = readFileSync(popupHtmlPath, "utf8").replace(/__POPUP_SCRIPT__/g, "./popup.js");
writeFileSync(popupHtmlPath, popupHtml);
