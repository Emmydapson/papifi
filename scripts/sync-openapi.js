const fs = require('fs');
const path = require('path');
const YAML = require('yamljs');

const docsDir = path.resolve(__dirname, '..', 'docs');
const jsonPath = path.join(docsDir, 'swagger.json');
const yamlPath = path.join(docsDir, 'openapi.yaml');
const jsonSource = fs.readFileSync(jsonPath, 'utf8').replace(/^\uFEFF/, '');
const document = JSON.parse(jsonSource);

const examples = require('./openapi-examples.json');

for (const [route, example] of Object.entries(examples)) {
  const operation = document.paths[route]?.post || document.paths[route]?.put || document.paths[route]?.patch;
  const mediaType = operation?.requestBody?.content?.['application/json'];
  if (!mediaType) throw new Error(`Missing application/json requestBody for ${route}`);
  mediaType.example = example;
}

const emptyBodyRoutes = [
  '/api/kyc/start',
  '/api/wallet/create/{userId}',
  '/api/wallet/create-usd/{userId}',
  '/api/wallet/cards/{id}/freeze',
  '/api/wallet/cards/{id}/unfreeze',
];
for (const route of emptyBodyRoutes) {
  document.paths[route].post.requestBody = {
    required: false,
    description: 'This operation does not consume input fields. Send an empty JSON object if a body is required by the client.',
    content: { 'application/json': { schema: { type: 'object', maxProperties: 0 }, example: {} } },
  };
}

document.components.schemas.MapleradWebhookRequest = {
  type: 'object',
  required: ['id', 'event', 'data'],
  properties: {
    id: { type: 'string', description: 'Provider event identifier.' },
    event: { type: 'string', description: 'Maplerad event name.' },
    data: { type: 'object', additionalProperties: true },
  },
};
document.paths['/api/wallet/webhook'].post.requestBody.content['application/json'].schema = {
  $ref: '#/components/schemas/MapleradWebhookRequest',
};

document.components.parameters.IdempotencyKey.example = 'money_move_docs_01';
document.components.parameters.MapleradSignature.example = 'DOCS_ONLY_HMAC_SIGNATURE';

// Keep the documented profile payload aligned with profileService.updateProfile.
document.components.schemas.ProfileUpdateRequest = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gender: { type: 'string' },
    phoneNumber: { type: 'string' },
    country: { type: 'string', example: 'NG' },
    nationality: { type: 'string' },
    dateOfBirth: { type: 'string', format: 'date' },
    address: { type: 'string' },
  },
};

const serializedDocument = `${JSON.stringify(document, null, 2)}\n`;
fs.writeFileSync(jsonPath, serializedDocument);
fs.writeFileSync(yamlPath, YAML.stringify(document, 10, 2));
