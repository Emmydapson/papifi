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
document.paths['/api/wallet/webhook'].post.description =
  'Unauthenticated provider callback. Authenticity is checked with Maplerad/Svix svix-id, svix-timestamp, and svix-signature headers over the exact raw body. Provider private payloads are not documented.';
document.paths['/api/wallet/webhook'].post.parameters = [
  { $ref: '#/components/parameters/SvixId' },
  { $ref: '#/components/parameters/SvixTimestamp' },
  { $ref: '#/components/parameters/SvixSignature' },
];

document.components.parameters.IdempotencyKey.example = 'money_move_docs_01';
delete document.components.parameters.MapleradSignature;
document.components.parameters.SvixId = {
  name: 'svix-id',
  in: 'header',
  required: true,
  description: 'Maplerad webhook message identifier. Reused when the same webhook is retried.',
  schema: { type: 'string' },
  example: 'msg_docs_01',
};
document.components.parameters.SvixTimestamp = {
  name: 'svix-timestamp',
  in: 'header',
  required: true,
  description: 'Unix timestamp in seconds used for replay protection.',
  schema: { type: 'string' },
  example: '1760000000',
};
document.components.parameters.SvixSignature = {
  name: 'svix-signature',
  in: 'header',
  required: true,
  description: 'Space-delimited Maplerad/Svix HMAC-SHA256 signatures, usually prefixed with a version such as v1,.',
  schema: { type: 'string' },
  example: 'v1,DOCS_ONLY_SIGNATURE',
};

const docsEmailExample = 'ada.okafor@operator-controlled-domain.tld';
for (const schemaName of ['RegisterRequest', 'LoginRequest', 'EmailRequest']) {
  if (document.components.schemas[schemaName]?.properties?.email) {
    document.components.schemas[schemaName].properties.email.example = docsEmailExample;
  }
}

// Keep the documented profile payload aligned with profileService.updateProfile.
document.components.schemas.ProfileUpdateRequest = {
  type: 'object',
  additionalProperties: false,
  properties: {
    phoneNumber: { type: 'string' },
    country: { type: 'string', example: 'NG' },
    nationality: { type: 'string', example: 'NG' },
    dateOfBirth: { type: 'string', format: 'date' },
    address: { type: 'string' },
    city: { type: 'string' },
    state: { type: 'string' },
    postalCode: { type: 'string' },
  },
};

for (const field of ['city', 'state', 'postalCode', 'country']) {
  document.components.schemas.Profile.properties[field] = { type: 'string', nullable: true };
}

document.components.schemas.KycResultResponse = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    code: { type: 'string', example: 'BVN_VERIFIED' },
    status: { type: 'string', enum: ['PASSED', 'FAILED'] },
    accountTier: { type: 'string', enum: ['BVN_VERIFIED', 'APPROVED'] },
    verificationId: { type: 'string', format: 'uuid' },
    reused: { type: 'boolean' },
    tier1Enrollment: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['NOT_STARTED', 'PROFILE_INCOMPLETE', 'PENDING', 'PROCESSING', 'TIER_1', 'RETRYING', 'RECONCILIATION_REQUIRED', 'FAILED'],
        },
        mapleradCustomerTier: { type: 'string', enum: ['TIER_1'] },
        code: { type: 'string', enum: ['MAPLERAD_TIER1_PROFILE_INCOMPLETE', 'MAPLERAD_TIER1_ENROLLMENT_FAILED'] },
        missingFields: {
          type: 'array',
          items: { type: 'string', enum: ['dateOfBirth', 'phoneNumber', 'address', 'city', 'state', 'country', 'postalCode'] },
        },
        providerStatus: { type: 'integer' },
        requestId: { type: 'string' },
      },
    },
    walletProvisioning: {
      type: 'object',
      properties: {
        currency: { type: 'string', enum: ['NGN'] },
        state: { type: 'string', enum: ['KYC_REQUIRED', 'PENDING', 'PROCESSING', 'RETRYING', 'FAILED', 'RECONCILIATION_REQUIRED', 'PROVISIONED'] },
      },
    },
  },
};

document.components.schemas.AuthTokenResponse = {
  type: 'object',
  properties: {
    token: { type: 'string', example: 'jwt_token' },
    userId: { type: 'string', format: 'uuid' },
    message: { type: 'string' },
  },
  required: ['token', 'userId', 'message'],
};

document.components.schemas.BvnRequest = {
  type: 'object',
  required: ['bvn'],
  properties: {
    bvn: {
      type: 'string',
      pattern: '^\\d{11}$',
      description: '11 digit BVN. Do not store or log in frontend/mobile clients.',
      writeOnly: true,
    },
    dateOfBirth: {
      type: 'string',
      description: 'Optional override for Tier 1 upgrade. Accepted as YYYY-MM-DD or DD-MM-YYYY.',
      example: '1995-04-12',
    },
    phoneNumber: {
      type: 'string',
      description: 'Optional Nigerian phone override for Tier 1 upgrade.',
      example: '+2348012345678',
    },
    address: {
      type: 'object',
      description: 'Structured home address required by Maplerad Tier 1 upgrade when profile does not already provide these fields.',
      properties: {
        street: { type: 'string', example: '12 Example Road' },
        street2: { type: 'string', nullable: true },
        city: { type: 'string', example: 'Ikeja' },
        state: { type: 'string', example: 'Lagos' },
        country: { type: 'string', example: 'NG' },
        postal_code: { type: 'string', example: '100001' },
        postalCode: { type: 'string', example: '100001' },
      },
    },
    city: { type: 'string', description: 'Fallback city if address is stored as a string.' },
    state: { type: 'string', description: 'Fallback state if address is stored as a string.' },
    country: { type: 'string', description: 'Fallback country if address is stored as a string.', example: 'NG' },
    postalCode: { type: 'string', description: 'Fallback postal code if address is stored as a string.' },
    postal_code: { type: 'string', description: 'Fallback postal code if address is stored as a string.' },
    photo: { type: 'string', format: 'uri', description: 'Optional selfie/photo URL for Tier 1 upgrade.' },
  },
};

document.components.schemas.KycStatusResponse = {
  type: 'object',
  properties: {
    userId: { type: 'string', format: 'uuid' },
    verifications: {
      type: 'array',
      items: { $ref: '#/components/schemas/KycVerificationSummary' },
    },
  },
};

document.components.schemas.KycVerificationSummary = {
  oneOf: [
    { $ref: '#/components/schemas/KycBvnSummary' },
    { $ref: '#/components/schemas/KycDocumentSummary' },
  ],
};
delete document.components.schemas.KycVerification;

document.components.schemas.KycBvnSummary = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['BVN'] },
    status: { type: 'string', enum: ['PENDING', 'PASSED', 'FAILED'] },
    provider: { type: 'string', example: 'maplerad' },
    providerEnvironment: { type: 'string', enum: ['sandbox', 'production'] },
    providerRequestId: { type: 'string' },
    bvn: {
      type: 'object',
      additionalProperties: false,
      properties: {
        last4: { type: 'string', example: '7891' },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
    verifiedAt: { type: 'string', format: 'date-time' },
    attemptCount: { type: 'integer', minimum: 1 },
  },
};

document.components.schemas.KycDocumentSummary = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['NIN', 'DRIVERS_LICENSE', 'INTERNATIONAL_PASSPORT', 'VOTERS_CARD'] },
    status: { type: 'string', enum: ['PENDING', 'PASSED', 'FAILED'] },
    issuedCountry: { type: 'string', example: 'NG' },
    expiresAt: { type: 'string', format: 'date' },
    createdAt: { type: 'string', format: 'date-time' },
    attemptCount: { type: 'integer', minimum: 1 },
  },
};

document.components.schemas.SafeWallet = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    currency: { $ref: '#/components/schemas/Currency' },
    availableBalance: { type: 'number', example: 0 },
    pendingBalance: { type: 'number', example: 0 },
    ledgerBalance: { type: 'number', example: 0 },
    accountNumber: { type: 'string', nullable: true, example: '******7890' },
    bankName: { type: 'string', nullable: true },
    status: { type: 'string' },
    providerEnvironment: { type: 'string', enum: ['sandbox', 'production'] },
  },
};
document.components.schemas.WalletResponse = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    wallet: { $ref: '#/components/schemas/SafeWallet' },
  },
};
document.components.schemas.WalletListResponse = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    walletState: { type: 'string', enum: ['PROVISIONED', 'PENDING_PROVISIONING', 'KYC_REQUIRED', 'NOT_PROVISIONED', 'RECONCILIATION_REQUIRED'] },
    wallets: {
      type: 'array',
      items: { $ref: '#/components/schemas/SafeWallet' },
    },
  },
};
document.components.schemas.UsdAccountRequestResponse = document.components.schemas.WalletResponse;

const serializedDocument = `${JSON.stringify(document, null, 2)}\n`;
fs.writeFileSync(jsonPath, serializedDocument);
fs.writeFileSync(yamlPath, YAML.stringify(document, 10, 2));
