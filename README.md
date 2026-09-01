# QTH Simulacros

Aplicación interna para subir temarios PDF, procesarlos con RAG y generar preguntas tipo test exportables a Excel.

## Tecnologías

- Frontend: React y Vite
- Backend: Node.js y Express
- Base de datos: PostgreSQL con pgvector
- IA: OpenAI API
- Exportación: `.xlsx`

## Primera instalación

Ejecuta todos los comandos desde la raíz:

```bash
cd /Volumes/SSD_SANDISK/qth_simulacros
```

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar el entorno

```bash
cp server/.env.example server/.env
```

Edita `server/.env` y configura `OPENAI_API_KEY` y un `JWT_SECRET` seguro.

### 3. Iniciar PostgreSQL

Abre Docker Desktop y ejecuta:

```bash
docker compose up -d postgres
docker compose ps
```

### 4. Aplicar las migraciones

```bash
npm --workspace server run migrate
```

### 5. Crear los usuarios iniciales

Define los usuarios en `AUTHORIZED_USERS`, dentro de `server/.env`, y ejecuta:

```bash
npm --workspace server run seed
```

`seed` crea o actualiza usuarios. No arranca el backend y no es necesario ejecutarlo cada vez que se inicia la aplicación.

## Comprobar qué está arrancado

Antes de iniciar la aplicación, comprueba sus tres servicios:

```bash
docker compose ps
curl http://localhost:4000/health
curl -I http://localhost:5173
```

- Si PostgreSQL aparece con estado `Up`, ya está funcionando.
- Si el puerto `4000` devuelve `{"ok":true,...}`, el backend ya está funcionando.
- Si el puerto `5173` responde, el frontend ya está funcionando.

No vuelvas a iniciar un servicio que ya esté activo:

- Un segundo backend falla con `EADDRINUSE` porque el puerto `4000` está ocupado.
- Un segundo frontend puede abrirse en `5174` porque el puerto `5173` está ocupado.

Si los tres servicios ya funcionan, no ejecutes ningún otro comando. Abre directamente <http://localhost:5173>.

## Arrancar la aplicación

Elige solo una de las dos modalidades siguientes. No las combines.

### Modalidad A: backend y frontend juntos

Úsala cuando backend y frontend estén detenidos:

```bash
docker compose up -d postgres
npm run dev
```

El comando `npm run dev` arranca simultáneamente una instancia del backend y otra del frontend. No ejecutes después los comandos individuales.

### Modalidad B: terminales separadas

Esta modalidad es una alternativa a `npm run dev`.

Terminal 1 — PostgreSQL:

```bash
docker compose up -d postgres
```

Terminal 2 — backend:

```bash
npm --workspace server run dev
```

Terminal 3 — frontend:

```bash
npm --workspace client run dev
```

`npm --workspace client run dev` arranca solamente el frontend. `npm --workspace server run dev` arranca solamente el backend.

Direcciones:

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:4000>
- Salud del backend: <http://localhost:4000/health>

## Reiniciar los servicios

Si los ejecutaste en una terminal, pulsa `Ctrl+C` en ella antes de volver a iniciarlos.

Para localizar un backend que sigue ocupando el puerto `4000`:

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
kill NUMERO_PID
```

Para localizar un frontend en `5173` o una segunda instancia en `5174`:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:5174 -sTCP:LISTEN
```

Detén solo el proceso que quieras reiniciar y arranca una única instancia.

Para detener PostgreSQL sin borrar sus datos:

```bash
docker compose stop postgres
```

## Usuarios autorizados

El login no permite registro público. Los usuarios se crean con `AUTHORIZED_USERS` en `server/.env` o desde el panel de administración.

Ejemplo:

```json
[
  {
    "name": "Admin QTH",
    "email": "admin@qthsutan.es",
    "password": "cambia-esta-contrasena",
    "role": "ADMIN"
  }
]
```

## Embeddings y RAG

Los embeddings se guardan en PostgreSQL mediante pgvector:

- `document_chunks.embedding`: fragmentos de los PDF.
- `questions.embedding`: preguntas, para detectar duplicados semánticos.
- `quality_instructions.embedding`: instrucciones de calidad añadidas desde el panel de administración.

Durante la generación, el backend recupera fragmentos del PDF e instrucciones de calidad relevantes para el nivel y el contenido. Las instrucciones guían la redacción, pero no se utilizan como fuente factual.

El modelo predeterminado es:

```dotenv
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

## Errores frecuentes

### `EADDRINUSE ...:4000`

El backend ya está activo. Compruébalo y utiliza esa instancia:

```bash
curl http://localhost:4000/health
```

### El frontend se abre en `5174`

Ya existe un frontend en `5173`. Detén la nueva instancia con `Ctrl+C` y abre <http://localhost:5173>.

### `ECONNREFUSED ...:5432`

PostgreSQL está detenido:

```bash
docker compose up -d postgres
docker compose ps
```

### `zsh: command not found: docker`

Con Docker Desktop abierto, comprueba su herramienta:

```bash
/Applications/Docker.app/Contents/Resources/bin/docker --version
```

Si funciona, añádela al `PATH`:

```bash
echo 'export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```
Solo procesa los PDFs y no aplica cambios hechos directamente en el JSON
```npm run ingest-quality```

Para ejecutar cambios después de añadir instrucciones en instrucciones_generadas.json
```npm run quality:apply-instructions```