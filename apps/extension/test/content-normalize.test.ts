import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAdvertiserDomain,
  normalizeText,
  parsePodPosition,
  secondsToMilliseconds,
} from "../src/content/normalize.ts";

test("normalizeText trims and nulls blanks/non-strings", () => {
  assert.equal(normalizeText("  Coursera  "), "Coursera");
  assert.equal(normalizeText("   "), null);
  assert.equal(normalizeText(""), null);
  assert.equal(normalizeText(null), null);
  assert.equal(normalizeText(undefined), null);
  assert.equal(normalizeText(42), null);
});

test("parsePodPosition handles 'N of M' labels", () => {
  assert.deepEqual(parsePodPosition("1 of 2"), {
    podPosition: 1,
    podSize: 2,
  });
  assert.deepEqual(parsePodPosition("Ad 1  of  3"), {
    podPosition: 1,
    podSize: 3,
  });
  assert.deepEqual(parsePodPosition("2 OF 2"), {
    podPosition: 2,
    podSize: 2,
  });
});

test("parsePodPosition returns nulls for anything else", () => {
  assert.deepEqual(parsePodPosition(null), {
    podPosition: null,
    podSize: null,
  });
  assert.deepEqual(parsePodPosition(undefined), {
    podPosition: null,
    podSize: null,
  });
  assert.deepEqual(parsePodPosition(""), {
    podPosition: null,
    podSize: null,
  });
  assert.deepEqual(parsePodPosition("Ad"), {
    podPosition: null,
    podSize: null,
  });
});

test("secondsToMilliseconds rounds finite seconds", () => {
  assert.equal(secondsToMilliseconds(30), 30000);
  assert.equal(secondsToMilliseconds(0.5555), 556);
  assert.equal(secondsToMilliseconds(undefined), null);
  assert.equal(secondsToMilliseconds(NaN), null);
  assert.equal(secondsToMilliseconds(Infinity), null);
});

test("normalizeAdvertiserDomain trims and lowercases", () => {
  assert.equal(normalizeAdvertiserDomain(" DataCamp.com "), "datacamp.com");
  assert.equal(normalizeAdvertiserDomain("EXAMPLE.ORG"), "example.org");
  assert.equal(normalizeAdvertiserDomain("   "), null);
  assert.equal(normalizeAdvertiserDomain(null), null);
  assert.equal(normalizeAdvertiserDomain(undefined), null);
});
