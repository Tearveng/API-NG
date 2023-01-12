import { $isobject, $ok } from "foundation-ts/commons";
import { $inspect, $logterm } from "foundation-ts/utils";

export interface GenericLoggerInterface {
	log(l:any):void ; 
	error(l:any):void ;
}

export class GenericLogger implements GenericLoggerInterface {
	private loggerDelegate?:GenericLoggerInterface
	
	protected constructor(logger?:GenericLoggerInterface) {
		this.loggerDelegate = logger ;
	}

	public log(log:any) {
		if ($ok(this.loggerDelegate)) { 
			(<GenericLogger>this.loggerDelegate).log(log) ;
			return ; 
		} ;
		if ($ok(log) && $isobject(log)) log = $inspect(log) ;
		$logterm(log) ;
	}

	public error(log:any) {
		if ($ok(this.loggerDelegate)) { 
			(<GenericLogger>this.loggerDelegate).error(log) ;
			return ; 
		}
		this.log(log) ;
	}

}
