"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("Voyafundra retains login and trip controls", () => {
  const html = read("index.html");
  for (const id of ["authScreen", "authForm", "allTripsNav",
    "historyNav", "newTripBtn", "appContent", "modalLayer"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
});

test("iPhone navigation and cloud controls exist", () => {
  const html = read("index.html");
  for (const id of ["mobileNav", "refreshTripsBtn", "cloudStatusText",
    "connectionBanner"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /manifest\.webmanifest/);
});

test("all local script and stylesheet references exist", () => {
  const html = read("index.html");
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"[^>]*>/g)) {
    const url = match[1];
    if (/^(https?:|\/\/|#)/.test(url)) continue;
    assert.ok(fs.existsSync(path.join(root, url)), "Missing resource: " + url);
  }
});

test("manifest is valid and preserves standalone install mode", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(root, icon.src)), "Missing icon: " + icon.src);
  }
});

test("public Supabase config never contains a service-role or secret key", () => {
  assert.doesNotMatch(read("supabase-conf.js"), /sb_secret_|service_role|SUPABASE_SERVICE_ROLE_KEY/i);
});

test("cloud refresh refuses to discard failed saves", () => {
  const code = read("experience.js");
  assert.match(code, /cloudSaveError/);
  assert.match(code, /cloudWritesPending/);
  assert.match(code, /refreshCloudTripsSafely/);
  const app = read("app.js");
  assert.match(app, /async function refreshCloudTripsSafely/);
  assert.match(app, /if \(error\) throw new Error/);
});

test("update prompt checks deployed code and guards pending trip saves", () => {
  const html = read("index.html");
  for (const id of ["versionUpdateNotice", "applyVersionUpdate", "deferVersionUpdate"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  const code = read("pwa-updates.js");
  assert.match(code, /cache: "no-store"/);
  assert.match(code, /cloudSaveError/);
  assert.match(code, /cloudWritesPending/);
  assert.match(code, /waitForCloudSaves/);
  assert.match(code, /modalLayer/);
  assert.match(code, /window\.location\.reload/);
  assert.doesNotMatch(code, /skipWaiting|caches\.open|supabase\.co/);
});
