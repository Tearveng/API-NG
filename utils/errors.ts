import { TSDictionary } from "foundation-ts/types";
import { $isobject } from "foundation-ts/commons";
import { Resp } from "foundation-ts/tsrequest";
import { TSHttpError } from "foundation-ts/tserrors";
import { $inspect } from "foundation-ts/utils";

export const BOOT_ERROR = -111 ;
export const EXTERNAL_SERVICES_ERROR = -222 ;
export const DATABASE_ERROR = -333 ;

export abstract class HTTPClientError extends TSHttpError {
	public readonly name!: string;

	protected constructor(status:Resp, name:string, message: object | string, info?:TSDictionary) {
        super($isobject(message) ? $inspect(message) : message as string, status, info)
		this.name = name;
        Error.captureStackTrace(this, this.constructor);
	}
    public get statusCode() { return this.status ; } // for previous code compatibility
}

export class BadRequestError extends HTTPClientError {
	constructor(message: string | object = 'Bad request', info?:TSDictionary) {
		super(Resp.BadRequest, 'ERR_BAD_REQUEST', message, info);
	}
}

export class ForbiddenError extends HTTPClientError {
    constructor(message: string | object = 'Forbidden', info?:TSDictionary) {
		super(Resp.Forbidden, 'ERR_FORBIDDEN', message, info);
	}
}

export class NotFoundError extends HTTPClientError {
    constructor(message: string | object = 'Not found', info?:TSDictionary) {
		super(Resp.NotFound, 'ERR_NOT_FOUND', message, info);
	}
}

export class ConflictError extends HTTPClientError {
    constructor(message: string | object = 'Conflict', info?:TSDictionary) {
		super(Resp.Conflict, 'ERR_CONFLICT', message, info);
	}
}

export class ManifestDataError extends HTTPClientError {
    constructor(message: string | object = 'Unprocessable', info?:TSDictionary) {
		super(Resp.Unprocessable, 'ERR_UNPROCESSABLE', message, info);
	}
}

export class DatabaseError extends HTTPClientError {
    constructor(message: string | object = 'Server Database Error', info?:TSDictionary) {
		super(Resp.InternalError, 'DATABASE_ERROR', message, info);
	}
}

export class FileError extends HTTPClientError {
    constructor(message: string | object = 'File Error', info?:TSDictionary) {
		super(Resp.InternalError, 'FILE_ERROR', message, info);
	}
}
export class CertignaRequestError extends HTTPClientError {
    constructor(message: string | object = 'Certigna request error', info?:TSDictionary) {
		super(Resp.InternalError, 'CERTIGNA_REQUEST_ERROR', message, info);
	}
}

export class InternalError extends HTTPClientError {
    constructor(message: string | object = 'Internal Error', info?:TSDictionary) {
		super(Resp.InternalError, 'INTERNAL_ERROR', message, info);
	}
}

export class NotImplementedError extends HTTPClientError {
    constructor(message: string | object = 'Not implemented', info?:TSDictionary) {
		super(Resp.NotImplemented, 'NOT_IMPLEMENTED', message, info);
	}
}

export class TimeOutError extends HTTPClientError {
    constructor(message: string | object = 'Gateway Timeout', info?:TSDictionary) {
		super(Resp.GatewayTimeOut, 'GATEWAY_TIMEOUT', message, info);
	}
}
