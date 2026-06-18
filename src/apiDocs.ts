import { Express } from 'express';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

export function registerApiDocs(app: Express): void {
  const enabled =
    process.env.API_DOCS_ENABLED === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.API_DOCS_ENABLED !== 'false');

  if (!enabled) return;

  const docsDir = path.resolve(process.cwd(), 'docs');
  const swaggerJsonPath = path.join(docsDir, 'swagger.json');
  const openApiYamlPath = path.join(docsDir, 'openapi.yaml');
  const openApiDocument = YAML.load(openApiYamlPath);

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.get('/swagger.json', (req, res) => {
    res.sendFile(swaggerJsonPath);
  });
  app.get('/openapi.yaml', (req, res) => {
    res.type('application/yaml').sendFile(openApiYamlPath);
  });
}
