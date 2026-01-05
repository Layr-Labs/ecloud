export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildError";
  }
}

export class AuthRequiredError extends BuildError {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class BuildFailedError extends BuildError {
  constructor(
    message: string,
    public readonly buildId: string,
  ) {
    super(message);
    this.name = "BuildFailedError";
  }
}

export class ConflictError extends BuildError {
  constructor(message = "Build already in progress") {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends BuildError {
  constructor(message = "Build not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends BuildError {
  constructor(message = "Permission denied") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class TimeoutError extends BuildError {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export class BadRequestError extends BuildError {
  constructor(message = "Bad request") {
    super(message);
    this.name = "BadRequestError";
  }
}
