import { APIGatewayProxyEvent } from 'aws-lambda';

export type Role = 'admin' | 'operator' | 'viewer';

export interface AuthContext {
  userId: string;
  role: Role;
  loginId: string;
}

export interface RBACPolicy {
  [endpoint: string]: {
    [method: string]: Role[];
  };
}

const rbacPolicies: RBACPolicy = {
  'GET /resources': {
    GET: ['admin', 'operator', 'viewer'],
  },
  'POST /api/{tableIndex}/bulk': {
    POST: ['admin', 'operator'],
  },
};

export function extractAuthContext(event: APIGatewayProxyEvent): AuthContext {
  const authHeader = event.headers['Authorization'] || '';
  const token = authHeader.replace('Bearer ', '');

  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    return {
      userId: decoded.userId || 'unknown',
      role: (decoded.role || 'viewer') as Role,
      loginId: decoded.loginId || 'unknown',
    };
  } catch {
    return {
      userId: 'unknown',
      role: 'viewer',
      loginId: 'unknown',
    };
  }
}

export function checkPermission(
  method: string,
  path: string,
  role: Role
): boolean {
  const key = `${method} ${path}`;
  const policy = rbacPolicies[key];

  if (!policy) {
    return false;
  }

  const allowedRoles = policy[method];
  if (!allowedRoles) {
    return false;
  }

  return allowedRoles.includes(role);
}

export function createUnauthorizedResponse() {
  return {
    statusCode: 403,
    body: JSON.stringify({
      error: 'Forbidden',
      message: 'You do not have permission to access this resource',
    }),
  };
}

export function createBadRequestResponse(message: string) {
  return {
    statusCode: 400,
    body: JSON.stringify({
      error: 'Bad Request',
      message,
    }),
  };
}

export function createNotFoundResponse(message: string) {
  return {
    statusCode: 404,
    body: JSON.stringify({
      error: 'Not Found',
      message,
    }),
  };
}

export function createInternalErrorResponse(message: string) {
  return {
    statusCode: 500,
    body: JSON.stringify({
      error: 'Internal Server Error',
      message,
    }),
  };
}

export function createSuccessResponse(data: unknown, statusCode = 200) {
  return {
    statusCode,
    body: JSON.stringify(data),
  };
}