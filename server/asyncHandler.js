/* Express 4 does not forward a rejected promise from an async handler to the
   error middleware — the request would just hang. Every async route and
   middleware is wrapped in this. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
