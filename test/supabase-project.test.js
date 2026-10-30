'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getExpectedSupabaseProjectRef } = require('../scripts/supabase-project');

const EXPECTED_PROJECT_REF = 'beynzbpqvcglxwkszpve';

function withProjectRef(value, callback) {
  const original = process.env.SUPABASE_PROJECT_REF;
  if (value === undefined) delete process.env.SUPABASE_PROJECT_REF;
  else process.env.SUPABASE_PROJECT_REF = value;
  try {
    callback();
  } finally {
    if (original === undefined) delete process.env.SUPABASE_PROJECT_REF;
    else process.env.SUPABASE_PROJECT_REF = original;
  }
}

test('el proyecto MoreMoney se usa como destino predeterminado', () => {
  withProjectRef(undefined, () => {
    assert.equal(getExpectedSupabaseProjectRef(), EXPECTED_PROJECT_REF);
  });
});

test('se acepta el identificador confirmado del proyecto', () => {
  withProjectRef(EXPECTED_PROJECT_REF, () => {
    assert.equal(getExpectedSupabaseProjectRef(), EXPECTED_PROJECT_REF);
  });
});

test('se rechaza cualquier identificador de proyecto distinto', () => {
  withProjectRef('otro-proyecto', () => {
    assert.throws(getExpectedSupabaseProjectRef, /SUPABASE_PROJECT_REF/);
  });
});
