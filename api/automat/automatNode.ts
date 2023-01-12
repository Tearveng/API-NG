import { $count } from "foundation-ts/commons";

import { RoleType } from "../APIConstants";
import { LocalID, ActorList, DocumentList } from "../APIIDs";

export interface AutomatNodeCreation {
	stepIndex:number ;		// the step which this node relates to
	roleType:RoleType ;		// is it approval or signing or expedition
	tag:string ; 			// the process tag 
	aids:ActorList ; 		// actors who can signe or approve at this stage
	dids:DocumentList ;		// documents which should be signed or approved
	concernedActors:number ;// number of actor which should sign or aprove or whatever
}

export interface AutomatNode extends AutomatNodeCreation {
	working_documents:ActorList[] ;	// per remaining document a list of actor ids who have signed the document	
	done_aids:ActorList ;			// actors who have fullfilled their duties
	done_dids:DocumentList ;		// documents which have been fully signed
}

export function automatNodeWorkingDocuments(self:AutomatNode) : number {
	if (self.dids.length === 0) return 0 ; // all is finished, no working documents
	let total = 0 ;
	self.working_documents.forEach(aids => {
		if (aids.length > 0 && aids.length < self.concernedActors) { total ++ ; }
	});
	return total ;
}

export interface SigningNode {
	did:LocalID ;
	aids:ActorList ;
} ;


export function automatNodeSigningNodes(self:AutomatNode) : SigningNode[]
{
	let ret:SigningNode[] = [] ;
	const n = $count(self.dids) ;
	for (let i = 0 ; i < n ; i++) {
		const signedAids = self.working_documents[i] ;
		const remainingAids = self.aids.filter(aid => !signedAids.includes(aid)) ; 
		if ($count(remainingAids)) {
			ret.push({did:self.dids[i], aids:remainingAids})
		}
	}
	return ret ;
}