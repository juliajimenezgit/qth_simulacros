# Revisión de reglas de generación

Revisión del archivo local `quality_sources/instrucciones/instrucciones_generadas.json`: 124 reglas, 25 activas. Para P se cargan 23: las 20 comunes y las 3 de ese nivel. Las reglas desactivadas no llegan al generador.

## Ajustes aplicados

| Regla | Problema | Criterio resultante |
| --- | --- | --- |
| `distractores-evitar-opciones-similares-o-ambiguas` | Exigía diferencias pequeñas en todos los niveles, mientras P pide alternativas fácilmente distinguibles. La exigencia de categoría homogénea tampoco explicitaba la excepción de opciones globales. | Proximidad según P/F/D y remisión a la regla de opciones globales. |
| `proceso-para-crear-pregunta-elegir-dificultad` | Pedía respetar la cantidad sin mencionar la excepción de devolver menos cuando faltan hechos nuevos verificables. | La cantidad es el objetivo del lote; nunca obliga a inventar. El servidor sigue exigiendo la cantidad completa para finalizar el test. |
| `referencia-clara` | Pedía redactar metadatos que el validador comparaba con una cadena exacta. | El modelo identifica el fragmento; el servidor construye la referencia. Se sigue verificando que el fragmento pertenezca al contexto y que las páginas citadas en la explicación coincidan. |
| `preguntas-p-opciones-globales` | No explicitaba el alcance de «Todas/Ninguna» ni la prohibición de combinarlas con preguntas de INCORRECTA presente en otra regla. | Se refieren a las otras tres alternativas, sin depender del orden, con una sola respuesta seleccionable; no se combinan con INCORRECTA. |

La regla de sustituciones controladas ya permitía valores incorrectos ausentes del manual. El revisor no recibía esa regla: ahora recibe las mismas reglas recuperadas que el generador y se aclara que una cita puede descartar varios valores. La cita debe seguir existiendo en el fragmento.

Las reglas antiguas sobre opciones combinadas por letras, trampas y contenido de relleno en D permanecen desactivadas. Sus textos pueden entrar en conflicto con los criterios activos si se reactivan; no explican la ejecución revisada.

## Diagnóstico y límites

Se separan plausibilidad y absolutos en los códigos de rechazo, y se incluyen los motivos y evidencias por opción en el registro y en la información del siguiente intento. Los fallos exclusivamente de formato o citas de la auditoría reciben un único reintento, sin volver a generar las preguntas ni repetir las auditorías ya válidas.

La detección de similitud y los límites de intentos se conservan. Las pruebas con respuestas simuladas verifican el flujo y las garantías de validación; la mejora de la tasa de aceptación debe medirse con generaciones reales.

El JSON es privado y está excluido de Git. Sus cambios se leen directamente al generar; no requieren volver a calcular embeddings. Para trasladar el ajuste a otro servidor debe copiarse también ese archivo privado.
