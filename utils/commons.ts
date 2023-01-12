import { Comparison, Ascending, Descending, Same, Nullable } from 'foundation-ts/types' ;
import { $ok, $length, $isstring } from 'foundation-ts/commons'
import { $dir, $filename } from 'foundation-ts/fs' ;
import { $logterm } from 'foundation-ts/utils';


export function $left(s: Nullable<string>, cut:number) : string {
	const n = $length(s) ; 
	if (!n) { return '' ; }
	return n < cut ? <string>s : (<string>s).slice(0, cut) ;
}

let __localDefaultPath = __dirname ;
['utils', 'tests', 'dist'].forEach(d => { 
    if ($filename(__localDefaultPath) === d) { __localDefaultPath = $dir(__localDefaultPath) ; } 
}) ;

export const DEFAULT_PATH = __localDefaultPath ;

export const MAX_POSITIVE_DISTANCE = 8640000000000000 ;
export const MAX_NEGATIVE_DISTANCE = -8640000000000000 ;

export function $now() { return $date2string() ; }

export function $date2string(aDate?: Nullable<Date | string>) : string {
	if ($ok(aDate) && $isstring(aDate) && $length(<string>aDate) > 0) { return <string>aDate ;}
	if (!$ok(aDate)) aDate = new Date() ;
	return (<Date>aDate).toISOString() ;
}

export function $finalDateString(date:Nullable<string>, seconds:number) : string {
	let dt = $length(date) ? new Date(<string>date) : new Date() ;
	if (!$ok(dt)) dt = new Date() ;
	return $date2string(new Date (dt.getTime()+seconds*1000)) ;
}

export function $compareDates(A?:Nullable<Date | string>, B?:Nullable<Date | string>) : Comparison {
    if ($isstring(A)) { A = new Date(A) ; }
    if ($isstring(B)) { B = new Date(B) ;}
	if ($ok(A)) {
		if ($ok(B)) {
			let tA = <number>((A as Date).getTime()), tB = <number>((B as Date).getTime()) ;
			return tA < tB ? Ascending : (tA > tB ? Descending : Same) ;
		}
		return Descending ;
	}
	return  $ok(B) ? Ascending : 0 ;
}

// returns time in seconds
export function $timeBetweenDates(A?:Nullable<Date | string>, B?:Nullable<Date | string>) : number {
    if ($isstring(A)) { A = new Date(A) ; }
    if ($isstring(B)) { B = new Date(B) ;}
    if ($ok(A)) {
		if ($ok(B)) {
			let tA = <number>((A as Date).getTime()), tB = <number>((B as Date).getTime()) ;
			return (tB - tA)/1000.0 ;
		}
		return MAX_POSITIVE_DISTANCE ;
	}
	return  $ok(B) ? MAX_NEGATIVE_DISTANCE : Same ;
}


// returns time in seconds

export function $phone(phone:string | null | undefined, dialCode?:string | null) : string {
	if ($length(phone)) {
		phone = (<string>phone).replace(/[^+0-9]/g, '').replace(/^00/, '+') ; // remove all non digit en + characters then replace leading 00 with +
		if ($length(dialCode)) {
			phone = phone.replace(/^0/, <string>dialCode) ;
		}
		return phone ;
	}
	return '' ;
}

export function $exit(reason:string='', status:number=0, name?:string) {
	if (status !== 0) {
		const processName = $length(name) ? name : `node process ${$filename(process.argv[1])}` ;
		$logterm('&0&o----------------------------------------------------&0') ;
		if ($length(reason)) {
			$logterm(`&oExiting &y${processName} &owith status &y${status} &ofor reason:\n\t&p${reason}&0`) ;
		}
		else {
			$logterm(`&oExiting &y${processName} &owith status &y${status}&0`) ;
		}
		$logterm('&o----------------------------------------------------&0') ;
	}
	else if ($length(reason)) { $logterm('&p'+reason+'&0') ; }
	process.exit(status) ;
}
