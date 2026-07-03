import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'required_permission';
/** Declares the permission code (e.g. "customers.write") required to hit a route. */
export const RequirePermission = (code: string) => SetMetadata(PERMISSION_KEY, code);
