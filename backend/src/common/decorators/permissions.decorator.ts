import { SetMetadata } from '@nestjs/common';
import { PermissionCode } from '../permissions';

export const PERMISSION_KEY = 'required_permission';
/**
 * Declares the permission code required to hit a route. Typed against the
 * PERM union so a typo'd code fails compilation instead of producing a
 * route nobody can ever access.
 */
export const RequirePermission = (code: PermissionCode) => SetMetadata(PERMISSION_KEY, code);
