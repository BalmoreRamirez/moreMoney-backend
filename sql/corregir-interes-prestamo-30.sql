-- El interés del préstamo no se almacena: la API lo calcula desde capital y tasa.
-- Este script conserva el 20% acordado, recalcula el estado con interés único
-- y muestra el saldo que debe presentar la aplicación corregida.
-- Registro de la captura: ID 30, "Fidelina agosto", capital $200, tasa 20%.

BEGIN;

DO $$
DECLARE
  v_nombre text;
  v_capital numeric(10, 2);
  v_tasa numeric(5, 4);
BEGIN
  SELECT deudor_nombre, capital, tasa_interes_mensual
    INTO v_nombre, v_capital, v_tasa
    FROM public.prestamos
   WHERE id = 30
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el préstamo con ID 30.';
  END IF;

  IF v_nombre IS DISTINCT FROM 'Fidelina agosto'
     OR v_capital IS DISTINCT FROM 200.00::numeric
     OR v_tasa IS DISTINCT FROM 0.2000::numeric THEN
    RAISE EXCEPTION 'El préstamo 30 no coincide con Fidelina agosto / capital 200 / tasa 20%%. No se hicieron cambios.';
  END IF;
END $$;

-- El total adeudado es capital + 20% una sola vez. Solo corrige el estado
-- si los abonos ya cubren ese total; no altera abonos ni transacciones.
UPDATE public.prestamos AS p
   SET estado = CASE
     WHEN COALESCE((
       SELECT SUM(pp.monto)
         FROM public.pagos_prestamo AS pp
        WHERE pp.prestamo_id = p.id
     ), 0) >= p.capital + ROUND(p.capital * p.tasa_interes_mensual, 2)
     THEN 'pagado'
     ELSE 'activo'
   END,
       updated_at = CURRENT_TIMESTAMP
 WHERE p.id = 30
   AND p.estado IS DISTINCT FROM (
     CASE
       WHEN COALESCE((
         SELECT SUM(pp.monto)
           FROM public.pagos_prestamo AS pp
          WHERE pp.prestamo_id = p.id
       ), 0) >= p.capital + ROUND(p.capital * p.tasa_interes_mensual, 2)
       THEN 'pagado'
       ELSE 'activo'
     END
   );

SELECT
  p.id,
  p.deudor_nombre,
  p.capital,
  ROUND(p.tasa_interes_mensual * 100, 2) AS interes_porcentaje,
  ROUND(p.capital * p.tasa_interes_mensual, 2) AS interes_unico,
  p.capital + ROUND(p.capital * p.tasa_interes_mensual, 2) AS total_deuda,
  COALESCE(SUM(pp.monto), 0) AS total_pagado,
  GREATEST(
    p.capital + ROUND(p.capital * p.tasa_interes_mensual, 2) - COALESCE(SUM(pp.monto), 0),
    0
  ) AS saldo_pendiente,
  p.estado
FROM public.prestamos AS p
LEFT JOIN public.pagos_prestamo AS pp ON pp.prestamo_id = p.id
WHERE p.id = 30
GROUP BY p.id;

COMMIT;
