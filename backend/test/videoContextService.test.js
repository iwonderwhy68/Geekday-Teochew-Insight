import test from "node:test";
import assert from "node:assert/strict";
import { buildSections, extractBvid, parseDanmakuXml } from "../src/videoContextService.js";

test("extractBvid extracts BV id from bilibili URL", () => {
  const bvid = extractBvid("https://www.bilibili.com/video/BV1Y8ZWBAEYh/?spm_id_from=333.1007");
  assert.equal(bvid, "BV1Y8ZWBAEYh");
});

test("parseDanmakuXml parses timestamp and text", () => {
  const xml = '<?xml version="1.0"?><i><d p="12.5,1,25,16777215,1771337752,0,abc,1,10">路书很好懂</d></i>';
  const rows = parseDanmakuXml(xml);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].second, 12.5);
  assert.equal(rows[0].text, "路书很好懂");
});

test("buildSections returns section array with boundaries", () => {
  const sections = buildSections(360, [
    { second: 10, text: "路书" },
    { second: 120, text: "左三右二" },
    { second: 240, text: "jump maybe" }
  ]);

  assert.ok(sections.length >= 3);
  assert.equal(sections[0].startSec, 0);
  assert.equal(sections[sections.length - 1].endSec, 360);
});
