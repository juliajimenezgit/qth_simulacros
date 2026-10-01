# QTH SUTAN · Revisión de la primera fase

Comparación del acta del 14/07/2026 con la aplicación local revisada el 01/10/2026.

La aplicación tiene implementado el flujo principal de configuración, generación, revisión y exportación de tests. Para cerrar la primera fase quedan funcionalidades expresamente recogidas en el acta, completar la utilización de los materiales y validar el resultado con los profesores.

Esta revisión incluye el código actual, también los cambios locales todavía sin confirmar en Git. «Implementado» significa comprobado en el código; no acredita que esa versión esté desplegada ni sustituye una prueba completa con usuarios y servicios reales. El acta se utiliza como referencia de alcance, no como instrucciones de ejecución.

## Mensaje para presentar al cliente

> Desde julio se ha ampliado la configuración por manual, tema, capítulo y dificultad; se han incorporado referencias automáticas, controles de calidad y ejemplos de la academia y de exámenes oficiales. El circuito principal está implementado. Para cerrar la fase debemos completar los permisos de lectura entre profesores, la eliminación de usuarios y la incorporación manual de preguntas; resolver la disponibilidad de la subida de documentos; verificar el CSV con vuestra plantilla; completar el aprovechamiento de los materiales y realizar una validación conjunta de la calidad.

No es recomendable dar un porcentaje de finalización: la aceptación de la calidad pedagógica sigue siendo una parte sustancial del trabajo.

## Comparación completa con el acta

| Compromiso | Estado actual | Qué falta para cerrarlo |
| --- | --- | --- |
| Inicio de sesión — pág. 2 | Implementado. Email y contraseña, sesión con token, cierre de sesión y acceso protegido. No hay registro público. | Verificación de acceso con las cuentas del entorno de entrega. |
| Crear y modificar usuarios — pág. 3 | Implementado. Nombre, email, contraseña y rol. | Validación funcional con el administrador. |
| Eliminar usuarios — pág. 3 | No localizado en la interfaz ni en las rutas del servidor. El acta lo marcaba como hecho. | Incorporar la eliminación y definir qué ocurre con los documentos y tests del usuario. Si se prefiere una baja o desactivación, acordarla como alternativa. |
| Permisos individuales de lectura de tests ajenos — pág. 3 | Parcial. Administrador y desarrollador ven todo; el profesor ve sus propios datos. | Permitir conceder y revocar lectura entre usuarios sin otorgar administración ni edición de contenido ajeno. |
| Subir PDF por manual, tema y capítulo — pág. 3 | Código de subida y clasificación implementado, incluida selección múltiple, pero el botón está deshabilitado con una constante. | Reactivar y validar la subida, o documentar con el cliente que esta entrega utiliza exclusivamente temarios precargados. |
| Elegir cantidad de preguntas por manual, tema y capítulo — págs. 3–4 | Implementado por documento seleccionado, con categorías, reparto y comprobación de totales. Límite actual: 120 preguntas por test. | Probar los repartos sobre el material acordado. La selección interna depende de los PDF disponibles; no es un selector libre de cualquier apartado de un manual. |
| Repartir preguntas entre P, F y D — pág. 4 | Implementado. P = Principiante; F = Fácil; D = Difícil. | Validar que la dificultad real se corresponde con el criterio de los profesores. |
| Enunciado, cuatro opciones, correcta y explicación — pág. 4 | Implementado en generación, almacenamiento, revisión y exportación. | Validación pedagógica de una muestra representativa. |
| Manual, tema, capítulo y referencia concreta — pág. 4 | Implementado con vínculo al fragmento original, apartado y página; intenta usar la numeración impresa del manual. | Comprobar referencias en los seis bloques. Hay valores de reserva «No identificado» y dependencia de la extracción y los nombres de archivo. |
| Embeddings y recuperación semántica del manual — págs. 4–5 | Parcial respecto a la formulación del acta. Se calculan embeddings de documentos y se usan vectores para reglas, ejemplos y duplicados. La selección del texto del manual se hace por cobertura, secciones y fragmentos menos utilizados. | Incorporar la búsqueda semántica de fragmentos del manual, o aceptar expresamente el enfoque actual tras comprobar sus resultados. |
| Mejorar redacción, distractores, explicaciones, dificultad y respuesta única — págs. 5–6 | Implementados controles estructurales, auditoría mediante IA, comprobación de evidencias y reparación de longitud de opciones. | Medir el resultado real, corregir los casos rechazados por docentes y acordar aceptación. Los controles automáticos no acreditan por sí solos calidad final. |
| Evitar preguntas repetidas — pág. 6 | Detección semántica dentro del mismo test, incluso entre documentos. El historial se aporta como orientación; las preguntas pueden repetirse entre tests distintos. | Confirmar si el compromiso exige también evitar repeticiones entre tests; ampliar el alcance si así se acuerda. |
| Aplicar la guía QTH — págs. 4–6 | Reglas integradas y filtradas por nivel. El archivo local actual contiene 45 reglas, 43 activas. | Validar el criterio con QTH y comprobar que el archivo privado correcto se entrega y utiliza en el servidor. |
| Adaptarse al estilo de exámenes oficiales — pág. 6 | Parcial. Se recuperan ejemplos oficiales y se incorporan ejemplos de profesores y reglas de estilo. | Completar los materiales legibles y contrastar longitud, distractores y dificultad con exámenes reales. No se ha localizado análisis estadístico de frecuencias temáticas ni un reparto derivado de esas frecuencias. |
| Revisar, modificar y eliminar preguntas — págs. 4–5 | Implementado: enunciado, opciones, correcta, explicación, referencia y nivel. | Validación de uso con profesores. |
| Añadir preguntas manualmente — pág. 5 | No localizado formulario ni ruta de creación manual. El acta lo marcaba como hecho. | Añadir preguntas a un test desde el editor y conservarlas en revisión y exportación. |
| Exportar CSV exactamente según la plantilla QTH — pág. 5 | Exportación CSV implementada, además de otros formatos. No está acreditada la compatibilidad exacta con la plantilla de importación. | Obtener o confirmar la plantilla autorizada y realizar una importación real con un CSV exportado por la app. |
| Pruebas y validación con profesores — pág. 6 | No se ha localizado evidencia de aceptación final en los archivos revisados. | Organizar pruebas, registrar incidencias, ajustar el motor y documentar la conformidad. |

## Funcionalidades actuales adicionales

Estas capacidades existen en la versión revisada y ayudan a mostrar el avance, aunque no todas se pedían expresamente en el acta:

- Biblioteca con búsqueda por nombre, filtros por tipo, fechas, estado y profesor; paginación; cambio de nombre; borrado individual y en lote; reprocesado de documentos con error. El código también contempla duplicados y sustitución de PDF, actualmente inaccesibles por estar desactivada la subida.
- Selección conjunta de manuales y sus documentos relacionados. La jerarquía se deduce en parte del nombre del PDF y está adaptada a los materiales CEIS.
- Asistente de generación por pasos, nombre de test con sugerencia automática, reparto por documento y preajustes de dificultad.
- Seguimiento de generación al navegar por otras pantallas; recuperación del seguimiento después de recargar; conservación de preguntas ya validadas cuando una generación falla. Un test solo se marca completado cuando cumple la cantidad y el reparto solicitados.
- Histórico de tests y revisión filtrada por test y documento.
- Exportación a Excel, Word, PDF, CSV y JSON. Word y PDF incluyen la respuesta correcta y explicación; sirven como documento de revisión, no como versión sin soluciones para alumnos.
- Panel de administración con totales, niveles, estados de tests, tiempos medios, actividad del equipo y detalle por usuario. Mide accesos y minutos con la pestaña visible; no equivale a medir atención o trabajo efectivo.
- Rol de desarrollador con permisos equivalentes a administrador.
- Gestión técnica de reglas de calidad mediante API y herramientas internas. La pantalla actual de administración no muestra un editor de esas reglas.
- Herramientas para crear equipo y actividad de demostración. Si se han ejecutado, las estadísticas incluyen datos ficticios; hay que comprobarlo antes de presentar las cifras como uso real.

## Materiales: comprobación realizada

El repositorio contiene el manual completo de Incendios y sus seis bloques: teoría del fuego, hidráulica, interior y ventilación, túneles, industriales y vegetación. También hay PDF separados de capítulos y materiales de otros manuales. Su presencia en disco no acredita que estén todos cargados y disponibles para cada profesor.

Se ejecutó el lector local sobre los 23 PDF de la biblioteca privada, sin enviar datos a la IA ni modificar la base de datos: 17 exámenes oficiales, 5 documentos de apuntes y 1 guía. Se obtuvieron 476 páginas con texto y 1.560 fragmentos. Cinco exámenes produjeron cero texto y cero fragmentos:

- `2019_examen_oficial_bombero_y_respuestas (1).pdf`
- `cp006943-20260710142229 (1).pdf`
- `examen_donostia (1).pdf`
- `examen_ofizial_gipu_2025 (2).pdf`
- `oficial_examen_especificio.pdf`

Estos archivos necesitan OCR o una versión con texto utilizable, seguido de una nueva incorporación a la biblioteca. El flujo actual omite los archivos de los que no obtiene fragmentos. La prueba no verifica qué versiones se incorporaron previamente a la base de datos.

Los cinco apuntes se corresponden por nombre con teoría del fuego, hidráulica, túneles, industriales y vegetación. No se ha localizado un archivo específico de interior y ventilación en esa carpeta: confirmar si falta o está incluido en otro PDF.

La extracción actual lee texto del PDF; no interpreta explícitamente colores de subrayado ni anotaciones gráficas. Tener el PDF subrayado no garantiza que el sistema aproveche qué contenido destacó la academia. Conviene verificar esta parte con ejemplos concretos.

Hay preguntas de ejemplo de profesores en JSON, organizadas en principiante, aleatorio y élite, que el generador selecciona y adapta a P/F/D. Se utilizan como ejemplos en el contexto; no se ha localizado un entrenamiento específico del modelo.

## Pendientes propuestos, por orden de cierre

| Prioridad | Trabajo | Criterio propuesto para darlo por cerrado |
| --- | --- | --- |
| Alta | Permisos individuales de lectura. | Un profesor accede a un test ajeno autorizado; no puede editarlo; al revocar el permiso deja de verlo. Comprobar también exportación y acceso por API. |
| Alta | Eliminación de usuarios. | La acción existe, tiene un tratamiento acordado de los contenidos y no deja al equipo sin administración. |
| Alta | Incorporación manual de preguntas. | Una pregunta creada por el profesor queda asociada al test y aparece correctamente al revisar y exportar. |
| Alta | Disponibilidad de subida y temarios. | El profesor dispone del material previsto y puede subir PDF categorizados, o queda documentada la excepción de biblioteca precargada. |
| Alta | Compatibilidad CSV. | El sistema habitual de QTH importa el fichero sin recolocar columnas ni corregir respuestas, tildes o explicaciones. |
| Alta | Completar materiales y verificar su incorporación. | Resolver los cinco PDF sin texto, confirmar apuntes del sexto bloque y comprobar disponibilidad de reglas, ejemplos y referencias en el entorno de entrega. |
| Alta | Validación conjunta del motor. | Profesores revisan una muestra acordada de los seis bloques y los tres niveles; se registran correcciones y se acepta el resultado. |
| Media | Cerrar la diferencia de recuperación semántica. | Se implementa la búsqueda vectorial del manual o se documenta la aceptación del mecanismo de cobertura actual. |
| Media | Confirmar el alcance del estilo oficial y antirrepetición. | Se acuerda si deben calcularse frecuencias temáticas y evitar repeticiones entre tests, y se verifica el comportamiento pactado. |

Estas prioridades son una propuesta para organizar el cierre; no eliminan compromisos del acta. No se asignan horas sin concretar el tratamiento de usuarios, permisos, plantilla y criterios de calidad.

## Propuesta de validación y acuerdos para la reunión

1. Confirmar los pendientes funcionales y si mantener la subida desactivada fue una decisión aceptada por QTH.
2. Obtener la plantilla de importación vigente y definir quién validará el CSV.
3. Confirmar el sexto documento de apuntes y las copias legibles de los exámenes pendientes.
4. Designar profesores revisores y acordar una muestra que cubra los seis bloques y P/F/D. Como punto de partida se propone revisar al menos 10 preguntas por combinación, 180 en total; es una propuesta, no un requisito del acta.
5. Registrar para cada pregunta: utilidad sin cambios, cambios menores, rechazo, adecuación del nivel, ambigüedad y corrección de la referencia. Medir también tests completos, fallos, tiempos y coste de generación.
6. Fijar con el cliente los umbrales de aceptación y una fecha de revisión. La generación sin revisión humana aparece en el acta como aspiración futura; no debe presentarse como una garantía actual.

El acta deja el presupuesto detallado en un documento independiente. Esta revisión no comprueba facturas, horas consumidas ni aceptación económica.

## Evidencias técnicas y límites de la revisión

Comprobaciones ejecutadas: 113 pruebas automáticas correctas, 0 fallos; comprobación de sintaxis de entrada del servidor y compilación de producción del cliente correctas; lectura local de los 23 PDF de calidad. Las pruebas incluyen simulaciones de servicios y no sustituyen generaciones reales ni la aceptación del cliente. No se ejecutaron generaciones de pago, pruebas de navegador ni consultas a la base de datos de producción.

Archivos principales para contrastar los hallazgos:

- `client/src/pages/Documents.jsx`: `PDF_UPLOADS_ENABLED = false`, categorías, filtros y acciones de biblioteca.
- `server/src/routes/adminRoutes.js` y `server/src/services/authService.js`: altas y modificaciones de usuarios, sin eliminación.
- `server/src/services/questionService.js`: permisos por propietario/rol, reparto, generación, referencias, consulta y exportación; `getContextChunks` selecciona por cobertura; `findSimilarQuestion` limita duplicados al test en curso.
- `server/src/services/documentService.js`: procesamiento y embeddings de PDF. Puede continuar solo con texto cuando no consigue calcular embeddings; un documento disponible no garantiza por sí mismo vectores completos.
- `server/src/routes/questionRoutes.js` y `client/src/components/QuestionReview.jsx`: edición y borrado; no contienen creación manual.
- `server/src/services/exportService.js`: CSV con punto y coma, UTF-8 con BOM y cabeceras de la app. Exporta `Test`, `Pregunta`, `Opcion A–D`, `Correcta`, `Explicacion`, `Manual`, `Tema`, `Capitulo`, `Referencia` y `Nivel`.
- Los CSV de ejemplos en `quality_sources/preguntas_testor` tienen otras cabeceras. Son extracciones de preguntas, no evidencia suficiente de cuál es la plantilla oficial de importación.
- `server/src/services/qualityKnowledgeService.js`, `qualityInstructionService.js` y `teacherExamplesService.js`: recuperación de instrucciones, anotaciones y ejemplos.
- `server/src/db/ingestQuality.js` y `server/src/services/pdfService.js`: incorporación de materiales y extracción exclusivamente textual.
- `server/src/services/adminService.js` y `usageService.js`: estadísticas, seguimiento de uso e inclusión de datos de demostración si existen.

La nota anterior `docs/revision-reglas-generacion.md` indica 124 reglas y 25 activas; no coincide con el JSON local revisado, que contiene 45 y 43. Para esta comparación se ha tomado el archivo que lee actualmente el generador. Conviene actualizar esa documentación antes de la entrega.
