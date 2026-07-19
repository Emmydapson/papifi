import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import YAML from 'yamljs';
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

  const initializerResponse = await fetch(`${baseUrl}/api-docs/swagger-ui-init.js`);
  const initializer = await initializerResponse.text();

  assert.equal(initializerResponse.status, 200);
  assert.ok(
    initializer.indexOf('https://api.papifi.com') <
      initializer.indexOf('http://localhost:5000'),
  );
});

test('GET /swagger.json serves the JSON API document', async () => {
  const response = await fetch(`${baseUrl}/swagger.json`);
  const document = await response.json() as {
    openapi?: string;
    servers?: Array<{ url?: string }>;
    paths?: Record<string, Record<string, {
      requestBody?: { content?: Record<string, { schema?: unknown; example?: unknown }> };
      parameters?: Array<{ $ref?: string }> | { $ref?: string };
      security?: Array<Record<string, unknown>>;
    }>>;
  };

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(document.openapi, '3.0.3');
  assert.deepEqual(document.servers, [
    { url: 'https://api.papifi.com' },
    { url: 'http://localhost:5000' },
  ]);

  const registerJson = document.paths?.['/api/auth/register']?.post
    ?.requestBody?.content?.['application/json'];
  assert.ok(registerJson?.schema);
  assert.deepEqual(registerJson?.example, {
    firstName: 'Ada',
    lastName: 'Okafor',
    email: 'ada.okafor@operator-controlled-domain.tld',
    password: 'DOCS_ONLY_PASSWORD',
    gender: 'female',
    phoneNumber: '+2348012345678',
  });

  for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of ['post', 'put', 'patch']) {
      const operation = pathItem[method];
      if (!operation) continue;
      const jsonBody = operation.requestBody?.content?.['application/json'];
      assert.ok(jsonBody?.schema, `${method.toUpperCase()} ${route} is missing its JSON request schema`);
      assert.ok(
        Object.prototype.hasOwnProperty.call(jsonBody, 'example'),
        `${method.toUpperCase()} ${route} is missing its JSON request example`,
      );
    }
  }

  const moneyMovementRoutes = [
    '/api/wallet/withdraw',
    '/api/wallet/cards/{id}/fund',
    '/api/wallet/cards/{id}/withdraw',
    '/api/transaction/log',
  ];
  for (const route of moneyMovementRoutes) {
    const operation = document.paths?.[route]?.post;
    const parameters = Array.isArray(operation?.parameters)
      ? operation.parameters
      : [operation?.parameters];
    assert.ok(
      parameters.some((parameter) => parameter?.$ref === '#/components/parameters/IdempotencyKey'),
      `POST ${route} is missing the Idempotency-Key header`,
    );
    assert.deepEqual(operation?.security, [{ bearerAuth: [] }]);
  }
});

test('GET /openapi.yaml serves the YAML API document', async () => {
  const response = await fetch(`${baseUrl}/openapi.yaml`);
  const body = await response.text();
  const document = YAML.parse(body) as {
    servers?: Array<{ url?: string }>;
    paths?: Record<string, Record<string, {
      requestBody?: { content?: Record<string, { schema?: unknown; example?: unknown }> };
    }>>;
  };

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/yaml/);
  assert.match(body, /^openapi: 3\.0\.3/m);
  assert.deepEqual(document.servers, [
    { url: 'https://api.papifi.com' },
    { url: 'http://localhost:5000' },
  ]);
  assert.ok(
    document.paths?.['/api/auth/register']?.post
      ?.requestBody?.content?.['application/json']?.schema,
  );
});
