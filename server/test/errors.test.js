import test from 'node:test';
import assert from 'node:assert/strict';
import { asyncHandler, errorHandler, HttpError, notFound } from '../src/utils/errors.js';

const run = (error, url = '/api/questions/generate') => {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  errorHandler(error, { method: 'POST', originalUrl: url }, res, () => {});
  return res;
};

test('warns in the terminal about every visible error, and hides internal details from the user', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const generation = run(new HttpError(422, 'Solo se pudieron validar 3 de 5 preguntas'));
  assert.equal(generation.statusCode, 422);
  assert.equal(generation.body.message, 'Solo se pudieron validar 3 de 5 preguntas');
  assert.match(warn.mock.calls[0].arguments[0], /422 POST \/api\/questions\/generate: Solo se pudieron validar/);

  const crash = run(new Error('conexión perdida con la base de datos'));
  assert.equal(crash.statusCode, 500);
  // The user sees a generic message; the terminal gets the real cause.
  assert.equal(crash.body.message, 'Error interno del servidor');
  assert.match(error.mock.calls[0].arguments[0], /500 POST .*conexión perdida/);
});

test('keeps routine 401 and 404 responses out of the terminal', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal(run(new HttpError(401, 'Sesión caducada')).statusCode, 401);
  assert.equal(run(new HttpError(404, 'Ruta no encontrada')).statusCode, 404);
  assert.equal(warn.mock.callCount(), 0);
});

test('sends unknown routes and async failures to the error handler', async () => {
  let received;
  notFound({}, {}, (error) => { received = error; });
  assert.equal(received.status, 404);
  const failure = new HttpError(409, 'El temario aún no está disponible');
  await asyncHandler(async () => { throw failure; })({}, {}, (error) => { received = error; });
  assert.equal(received, failure);
});
