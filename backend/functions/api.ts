import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  BatchWriteItemCommand,
  BatchWriteItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import {
  extractAuthContext,
  checkPermission,
  createUnauthorizedResponse,
  createBadRequestResponse,
  createNotFoundResponse,
  createInternalErrorResponse,
  createSuccessResponse,
} from './rbac';

const client = new DynamoDBClient({ region: 'ap-northeast-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.MAIN_TABLE || 'repair-management';

interface RepairCase {
  pk: string;
  sk: string;
  caseId: string;
  caseNumber: string;
  customerId: string;
  customerName: string;
  contactPhone?: string;
  contactEmail?: string;
  repairItem: string;
  repairContent: string;
  receivedAt: number;
  desiredCompletionDate?: number;
  status: string;
  priority?: string;
  assignedUserId?: string;
  estimatedAmount?: number;
  actualAmount?: number;
  completedAt?: number;
  notes?: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

interface Customer {
  pk: string;
  sk: string;
  customerId: string;
  customerName: string;
  customerNameKana?: string;
  phone?: string;
  email?: string;
  address?: string;
  billingAddress?: string;
  customerType?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
}

interface StatusTransitionHistory {
  pk: string;
  sk: string;
  transitionId: string;
  caseId: string;
  previousStatus: string;
  newStatus: string;
  reason?: string;
  createdAt: number;
  createdBy: string;
}

interface Estimate {
  pk: string;
  sk: string;
  estimateId: string;
  caseId: string;
  estimateNumber: string;
  estimateDate: number;
  expiryDate: number;
  content: string;
  materialCost: number;
  laborCost: number;
  totalAmount: number;
  tax?: number;
  taxIncludedTotal?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

interface Part {
  pk: string;
  sk: string;
  partId: string;
  partCode: string;
  partName: string;
  description?: string;
  unitPrice: number;
  stockQuantity: number;
  minimumStock?: number;
  supplier?: string;
  category?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
}

interface PartArrivalSchedule {
  pk: string;
  sk: string;
  scheduleId: string;
  partId: string;
  caseId?: string;
  plannedArrivalDate: number;
  quantity: number;
  supplier: string;
  orderNumber?: string;
  status: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

interface CustomerContactHistory {
  pk: string;
  sk: string;
  contactId: string;
  customerId: string;
  caseId?: string;
  contactDate: number;
  contactMethod: string;
  content: string;
  handler: string;
  nextContactDate?: number;
  createdAt: number;
  updatedAt: number;
}

interface LoginUser {
  pk: string;
  sk: string;
  userId: string;
  loginId: string;
  passwordHash: string;
  userName: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

interface UserPermission {
  pk: string;
  sk: string;
  permissionId: string;
  userId: string;
  permissionCode: string;
  permissionName: string;
  description?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

interface StatusMaster {
  pk: string;
  sk: string;
  statusId: string;
  statusCode: string;
  statusName: string;
  description?: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

interface EstimateAmountTier {
  pk: string;
  sk: string;
  tierId: string;
  tierName: string;
  minAmount: number;
  maxAmount: number;
  approvalPermissionLevel: string;
  feeRate?: number;
  notes?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

interface AutoReminder {
  pk: string;
  sk: string;
  reminderId: string;
  reminderName: string;
  targetStatusId: string;
  triggerDays: number;
  reminderMethod: string;
  messageTemplate?: string;
  maxReminderCount: number;
  reminderIntervalDays: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

interface AuditLog {
  pk: string;
  sk: string;
  auditId: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  changes?: Record<string, unknown>;
  timestamp: number;
}

type Entity =
  | RepairCase
  | Customer
  | StatusTransitionHistory
  | Estimate
  | Part
  | PartArrivalSchedule
  | CustomerContactHistory
  | LoginUser
  | UserPermission
  | StatusMaster
  | EstimateAmountTier
  | AutoReminder;

const tableConfigs: Record<
  number,
  {
    name: string;
    pkPrefix: string;
    skPrefix: string;
    idField: string;
  }
> = {
  0: {
    name: 'RepairCase',
    pkPrefix: 'CASE',
    skPrefix: 'CASE',
    idField: 'caseId',
  },
  1: {
    name: 'Customer',
    pkPrefix: 'CUSTOMER',
    skPrefix: 'CUSTOMER',
    idField: 'customerId',
  },
  2: {
    name: 'StatusTransitionHistory',
    pkPrefix: 'TRANSITION',
    skPrefix: 'TRANSITION',
    idField: 'transitionId',
  },
  3: {
    name: 'Estimate',
    pkPrefix: 'ESTIMATE',
    skPrefix: 'ESTIMATE',
    idField: 'estimateId',
  },
  4: { name: 'Part', pkPrefix: 'PART', skPrefix: 'PART', idField: 'partId' },
  5: {
    name: 'PartArrivalSchedule',
    pkPrefix: 'SCHEDULE',
    skPrefix: 'SCHEDULE',
    idField: 'scheduleId',
  },
  6: {
    name: 'CustomerContactHistory',
    pkPrefix: 'CONTACT',
    skPrefix: 'CONTACT',
    idField: 'contactId',
  },
  7: {
    name: 'LoginUser',
    pkPrefix: 'USER',
    skPrefix: 'USER',
    idField: 'userId',
  },
  8: {
    name: 'UserPermission',
    pkPrefix: 'PERMISSION',
    skPrefix: 'PERMISSION',
    idField: 'permissionId',
  },
  9: {
    name: 'StatusMaster',
    pkPrefix: 'STATUS',
    skPrefix: 'STATUS',
    idField: 'statusId',
  },
  10: {
    name: 'EstimateAmountTier',
    pkPrefix: 'TIER',
    skPrefix: 'TIER',
    idField: 'tierId',
  },
  11: {
    name: 'AutoReminder',
    pkPrefix: 'REMINDER',
    skPrefix: 'REMINDER',
    idField: 'reminderId',
  },
};

async function writeAuditLog(
  action: string,
  entityType: string,
  entityId: string,
  userId: string,
  changes?: Record<string, unknown>
): Promise<void> {
  const auditId = randomUUID();
  const auditLog: AuditLog = {
    pk: 'AUDIT',
    sk: `${Date.now()}#${auditId}`,
    auditId,
    action,
    entityType,
    entityId,
    userId,
    changes,
    timestamp: Date.now(),
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: auditLog,
    })
  );
}

async function handleGetResources(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const authContext = extractAuthContext(event);

  if (!checkPermission('GET', '/resources', authContext.role)) {
    return createUnauthorizedResponse();
  }

  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        Limit: 100,
      })
    );

    const items = result.Items || [];

    const resources = {
      repairCases: items.filter((item) => item.pk?.startsWith('CASE')),
      customers: items.filter((item) => item.pk?.startsWith('CUSTOMER')),
      statusTransitions: items.filter((item) =>
        item.pk?.startsWith('TRANSITION')
      ),
      estimates: items.filter((item) => item.pk?.startsWith('ESTIMATE')),
      parts: items.filter((item) => item.pk?.startsWith('PART')),
      partSchedules: items.filter((item) => item.pk?.startsWith('SCHEDULE')),
      contactHistories: items.filter((item) =>
        item.pk?.startsWith('CONTACT')
      ),
      users: items.filter((item) => item.pk?.startsWith('USER')),
      permissions: items.filter((item) => item.pk?.startsWith('PERMISSION')),
      statuses: items.filter((item) => item.pk?.startsWith('STATUS')),
      estimateTiers: items.filter((item) => item.pk?.startsWith('TIER')),
      reminders: items.filter((item) => item.pk?.startsWith('REMINDER')),
    };

    return createSuccessResponse(resources);
  } catch (error) {
    console.error('Error fetching resources:', error);
    return createInternalErrorResponse('Failed to fetch resources');
  }
}

async function handleBulkImport(
  event: APIGatewayProxyEvent,
  tableIndex: number
): Promise<APIGatewayProxyResult> {
  const authContext = extractAuthContext(event);

  if (!checkPermission('POST', '/api/{tableIndex}/bulk', authContext.role)) {
    return createUnauthorizedResponse();
  }

  if (!event.body) {
    return createBadRequestResponse('Request body is required');
  }

  try {
    const { items } = JSON.parse(event.body) as { items: Record<string, unknown>[] };

    if (!Array.isArray(items) || items.length === 0) {
      return createBadRequestResponse('items array is required and must not be empty');
    }

    const config = tableConfigs[tableIndex];
    if (!config) {
      return createBadRequestResponse(`Invalid table index: ${tableIndex}`);
    }

    const now = Date.now();
    const processedItems: Entity[] = [];
    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const item = items[i];
        const id = randomUUID();

        const processedItem: Record<string, unknown> = {
          ...item,
          pk: `${config.pkPrefix}#${id}`,
          sk: `${config.skPrefix}#${id}`,
          [config.idField]: id,
          createdAt: now,
          updatedAt: now,
          createdBy: authContext.userId,
          updatedBy: authContext.userId,
        };

        processedItems.push(processedItem as Entity);
      } catch (itemError) {
        errors.push(
          `Item ${i}: ${itemError instanceof Error ? itemError.message : 'Unknown error'}`
        );
      }
    }

    let imported = 0;
    let failed = 0;

    for (let i = 0; i < processedItems.length; i += 25) {
      const batch = processedItems.slice(i, i + 25);
      const writeRequests = batch.map((item) => ({
        PutRequest: {
          Item: item,
        },
      }));

      const params: BatchWriteItemCommandInput = {
        RequestItems: {
          [TABLE_NAME]: writeRequests,
        },
      };

      try {
        await client.send(new BatchWriteItemCommand(params));
        imported += batch.length;
      } catch (batchError) {
        failed += batch.length;
        errors.push(
          `Batch error: ${batchError instanceof Error ? batchError.message : 'Unknown error'}`
        );
      }
    }

    await writeAuditLog(
      'BULK_IMPORT',
      config.name,
      `bulk_${tableIndex}`,
      authContext.userId,
      {
        tableIndex,
        imported,
        failed,
        total: items.length,
      }
    );

    return createSuccessResponse(
      {
        imported,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      },
      201
    );
  } catch (error) {
    console.error('Error during bulk import:', error);
    return createInternalErrorResponse('Failed to process bulk import');
  }
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Received event:', JSON.stringify(event));

  const method = event.httpMethod;
  const path = event.path;

  try {
    if (method === 'GET' && path === '/resources') {
      return await handleGetResources(event);
    }

    const bulkMatch = path.match(/^\/api\/(\d+)\/bulk$/);
    if (method === 'POST' && bulkMatch) {
      const tableIndex = parseInt(bulkMatch[1], 10);
      return await handleBulkImport(event, tableIndex);
    }

    return createBadRequestResponse(`Unsupported endpoint: ${method} ${path}`);
  } catch (error) {
    console.error('Unhandled error:', error);
    return createInternalErrorResponse('An unexpected error occurred');
  }
}