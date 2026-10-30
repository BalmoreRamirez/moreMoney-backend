'use strict';

const EXPECTED_SUPABASE_PROJECT_REF = 'beynzbpqvcglxwkszpve';

function getExpectedSupabaseProjectRef() {
  const configuredRef = process.env.SUPABASE_PROJECT_REF;
  if (configuredRef && configuredRef !== EXPECTED_SUPABASE_PROJECT_REF) {
    throw new Error('SUPABASE_PROJECT_REF debe coincidir con el proyecto MoreMoney configurado.');
  }
  return EXPECTED_SUPABASE_PROJECT_REF;
}

module.exports = { getExpectedSupabaseProjectRef };
