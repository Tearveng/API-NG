
export function dbcol(table:string, col:string) : string 
{
	return `${table}.${col}` ;
}

export function dbid(table:string) : string 
{ 
	return dbcol(table, 'id') ;
}
