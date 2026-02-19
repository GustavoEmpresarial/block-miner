function formatZodError(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message
  }));
}

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      res.status(400).json({ ok: false, message: "Invalid request data.", errors: formatZodError(result.error) });
      return;
    }

    req.body = result.data;
    next();
  };
}

module.exports = {
  validateBody
};
