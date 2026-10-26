import { test } from "node:test";
import assert from "node:assert/strict";
import { signRequest, sha256Hex, amzDateNow } from "../worker/s3.ts";

// Known-answer tests: examples from AWS's "Signature Calculations for the Authorization
// Header" documentation (examplebucket / AKIAIOSFODNN7EXAMPLE).
const creds = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  amzDate: "20130524T000000Z",
};
const sig = (h: Record<string, string>) => /Signature=([0-9a-f]{64})/.exec(h.authorization)![1];

test("AWS vector: GET Object with Range header", async () => {
  const h = await signRequest({
    ...creds,
    method: "GET",
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    headers: { range: "bytes=0-9" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  });
  assert.match(h.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/);
  assert.equal(sig(h), "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
});

test("AWS vector: PUT Object (key with '$', extra signed headers)", async () => {
  const body = new TextEncoder().encode("Welcome to Amazon S3.");
  const payloadHash = await sha256Hex(body);
  assert.equal(payloadHash, "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
  const h = await signRequest({
    ...creds,
    method: "PUT",
    url: "https://examplebucket.s3.amazonaws.com/test%24file.text",
    headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
    payloadHash,
  });
  assert.match(h.authorization, /SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,/);
  assert.equal(sig(h), "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
});

test("host is always signed (the old client omitted it)", async () => {
  const h = await signRequest({
    ...creds,
    method: "PUT",
    url: "https://acct.r2.cloudflarestorage.com/bucket/backups/a.json.gz",
    headers: { "content-type": "application/gzip" },
    payloadHash: await sha256Hex(new Uint8Array(3)),
  });
  assert.match(h.authorization, /SignedHeaders=content-type;host;/);
});

test("amzDateNow has the SigV4 basic format", () => {
  assert.match(amzDateNow(new Date("2026-10-26T09:08:07.123Z")), /^20261026T090807Z$/);
});
