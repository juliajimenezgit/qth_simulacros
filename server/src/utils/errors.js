export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

export function notFound(req, res, next) {
  next(new HttpError(404, "Ruta no encontrada"));
}

const paint = (code, text) => (process.env.NO_COLOR ? text : `\x1b[${code}m${text}\x1b[0m`);

export function errorHandler(error, req, res, next) {
  const status = error.status || 500;

  // Every error the user sees also shows up in the terminal; 401/404 are routine and stay quiet.
  if (status >= 500) {
    console.error(paint("31", `✖ ${status} ${req.method} ${req.originalUrl}: ${error.message}`));
    console.error(error);
  } else if (![401, 404].includes(status)) {
    console.warn(paint("33", `⚠ ${status} ${req.method} ${req.originalUrl}: ${error.message}`));
  }

  res.status(status).json({
    message: status >= 500 ? "Error interno del servidor" : error.message,
    details: error.details,
  });
}
