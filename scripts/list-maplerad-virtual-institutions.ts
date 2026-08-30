import 'dotenv/config';
import { MapleRadService } from '../src/services/mapleradService';

async function main() {
  const service = new MapleRadService();
  const institutions = await service.listNgnVirtualInstitutions();
  console.log(`Maplerad NG VIRTUAL institutions (${service.getEnvironment()})`);
  console.log(`Count: ${institutions.length}`);
  for (const institution of institutions) {
    console.log(
      `code=${institution.code || '[unavailable]'} name=${institution.name || '[unavailable]'} type=${institution.type || '[unavailable]'} country=${institution.country || '[unavailable]'}`
    );
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
