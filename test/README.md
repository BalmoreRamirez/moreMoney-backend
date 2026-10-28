# Pruebas de integración financiera

Las pruebas de integración usan una base PostgreSQL separada. Su nombre debe comenzar por `more_money_test`; el backend rechaza el entorno `test` si el nombre no cumple esa regla o coincide con `DB_DATABASE`.

Configura `TEST_DB_DATABASE`, `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USERNAME` y `TEST_DB_PASSWORD`. Crea esa base vacía y aplica las migraciones antes de ejecutar:

```sh
npm run db:migrate:test
npm run test:integration
```

`npm test` ejecuta las pruebas unitarias y no requiere PostgreSQL. La suite de integración inserta y limpia sus registros en la base `more_money_test` indicada; no debe apuntar a datos reales.

La integración prueba 13 flujos financieros en los controladores y en PostgreSQL: cuentas, transferencias, movimientos manuales, egresos e ingresos, sueldos, inversiones, préstamos, créditos, tarjetas, compras normales y a tasa cero, calendario y confirmación de pagos. Incluye escenarios concurrentes de doble débito/cobro, límites, abonos y pagos repetidos. Las pruebas llaman los controladores directamente; no recorren la capa HTTP ni la autenticación.
