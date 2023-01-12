import { $length, $unsigned } from "foundation-ts/commons";
import { $map } from "foundation-ts/array";
import { $filename } from "foundation-ts/fs";

/*
	By defining specific type for all kind of public 
	ids we keep the code more readable : all session
	dependant objects have public ids of LocalID form
	and global objects like session, certification
	authority, uploads... have global ids.

	By typing specificaly these objects, we also can
	change their internal structure whenever we want
	with minimal code update

 */
export type GlobalID = number ;
export type LocalID = number ;

export type GlobalIDArrayDictionary = { [key: string]: GlobalID[] } ;
export type GlobalIDDictionary = 	  { [key: string]: GlobalID } ;
export type LocalIDArrayDictionary =  { [key: string]: LocalID[] } ;
export type LocalIDDictionary = 	  { [key: string]: LocalID } ;

export type ActorList = LocalID[];
export type DocumentList = LocalID[];

export function $gid (id:string|number|null|undefined):	GlobalID { return $unsigned(id) ; } 
export function $lid (id:string|number|null|undefined):	LocalID { return $unsigned(id) ; } 

function _url2id(url:string|null|undefined) : number
{
	if ($length(url)) {
		const id = parseInt($filename(<string>url), 10) ;
		return isNaN(id) || id <= 0 ? 0 : id ;
	}
	return 0 ;
}

export function $url2gid(url:string|null|undefined): GlobalID { return <GlobalID>_url2id(url) ; }
export function $url2lid(url:string|null|undefined): LocalID { return <LocalID>_url2id(url) ; }

export function $urls2gids(urls:string[]|null|undefined): GlobalID[] {
	return $map<string, GlobalID>(urls, url => {
		const r = $url2gid(url) ;
		return r > 0 ? r : undefined ;
	}) ;
}

export function $urls2lids(urls:string[]|null|undefined): LocalID[] {
	return $map<string, LocalID>(urls, url => {
		const r = $url2lid(url) ;
		return r > 0 ? r : undefined ;
	}) ;
}
