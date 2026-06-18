import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { registerApiDocs } from '../apiDocs';

let server: Server;
let baseUrl: string;

before(async () => {
  process.env.API_DOCS_ENABLED = 'true';

  const app = express();
  registerApiDocs(app);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('GET /api-docs serves Swagger UI', async () => {
  const response = await fetch(`${baseUrl}/api-docs`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(body, /Swagger UI/);
});

test('GET /swagger.json serves the JSON API document', async () => {
  const response = await fetch(`${baseUrl}/swagger.json`);
  const document = await response.json() as { openapi?: string };

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(document.openapi, '3.0.3');
});

test('GET /openapi.yaml serves the YAML API document', async () => {
  const response = await fetch(`${baseUrl}/openapi.yaml`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/yaml/);
  assert.match(body, /^openapi: 3\.0\.3/m);
});
