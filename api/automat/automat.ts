/**
 *  This is the automat for the api-ng
 *  If you want to coplexify the management
 * 	you will have to rewrite this automat
 *  but all opérations on it are in this file
 *  so never manipulate it without the current
 *  functions and you should be OK for upgrade
 *  compatibility.
 *
 *  Since Objection.js is a json object
 *  aware ORM, our automat is not a class
 *  but an interface (a JSON object) with
 *  fonctions to manipulate it. The drawback
 *  is that you need to copy the result every
 *  time you want something done
 */

import { $count, $ok } from "foundation-ts/commons";

import { ConflictError, InternalError } from "../../utils/errors";

import { LocalID, ActorList, DocumentList } from "../APIIDs";
import {
	AutomatNode,
	AutomatNodeCreation,
	SigningNode,
	automatNodeWorkingDocuments,
	automatNodeSigningNodes
} from './automatNode'

export interface Automat {
	nodes:AutomatNode[] ;
	index:number ;
}

export function newAutomat()
{
	return {
		nodes:[] as any[],
		index:0
	}
}

// ============ AUTOMAT INSTANCE METHODS =====================
export function addAutomatNode(self:Automat, node:AutomatNodeCreation)
{
	let workingDocs = [] ;
	const n = node.dids.length ;

	for (let i = 0 ; i < n ; i++) workingDocs.push([]) ;

	self.nodes.push(
		{
			working_documents:workingDocs, // an array full of empty arrays
			done_aids:[],
			done_dids:[],
			... node
		}
	) ;
}

export function automatCurrentNode(self:Automat) : AutomatNode | null
{
	if (!$ok(self) || !$ok(self.index)) return null ; // over protecting, I know
	const count = $count(self.nodes) ;
	if (self.index >= count) return null ;
	return self.nodes[self.index] ;
}

export type SigningNodeDictionary = { [key: string]: SigningNode[] } ;

// returns the documents to be signed in the current process
// since the automat is very simple : a suite of elementary processes
// there's for now, only one element in the returned dictionary
// Later, when the automat will allow to have several choices at the
// same time for one person, we may have several entries in this dictionary
export function automatSigningDocuments(self:Automat) : SigningNodeDictionary | null
{
	const node = automatCurrentNode(self) ;
	if (!$ok(node)) { return null ; }
	let signingNode = automatNodeSigningNodes(<AutomatNode>node) ;
	if (!$count(signingNode)) { return null ; }
	let ret:SigningNodeDictionary = {} ;
	ret[(<AutomatNode>node).tag] = signingNode ;
	return ret ;
}

export function isAutomatAtStart(self:Automat) : boolean {
	if (!$ok(self) || !$ok(self.index) || self.index !== 0) return false ;
	let node = self.nodes[self.index] ;
	return node.done_dids.length === 0 && automatNodeWorkingDocuments(node) === 0 ? true : false ;
}

export function isAutomatAtEnd(self:Automat) : boolean {
	if (!$ok(self) || !$ok(self.index)) return false ; // over protecting, I know
	const count = $count(self.nodes) ;
	if (!count || self.index >= count) return true ;
	return self.index === count-1 && self.nodes[self.index].dids.length === 0 ? true : false ;
}

export function aidsForAutomat(self:Automat) : ActorList
{
	let set = new Set<LocalID>() ;
	self.nodes.forEach(node => {
		node.aids.forEach(actor => set.add(actor)) ;
	}) ;
	return Array.from(set) ;
}

// ============ AUTOMAT EVOLUTION METHODS =====================

export function automatCopyWithActorAction(self:Automat, aid:LocalID, actionTag:string, dids:DocumentList) : Automat
{
	if (!$ok(self) || !$ok(self.index)) {
		throw new InternalError('automatCopyWithActorAction() on bad automat or bad automat index') ;
	}
	let n = $count(self.nodes) ;
	let index = self.index ;

	if (!n ||  index < 0 || index >= n) {
		throw new ConflictError('No more action to do on current automat')
	}

	let node = self.nodes[index] ;

	if (!$count(node.dids) || $count(node.done_aids) >= node.concernedActors) { index++ ; } // no more document, no more actors to be used at this step
	if (index >= n) {
		// we were on the last step
		throw new ConflictError('Automat was terminated')

	}

	node = self.nodes[index] ;
	if (actionTag !== node.tag) {
		// bad action for this step
		throw new ConflictError(`Bad action '${actionTag}' for automat step (needed '${node.tag}')`) ;
	}

	let actorIndex = node.aids.indexOf(aid) ;
	if (actorIndex < 0 || node.done_aids.includes(aid)) {
		 // actor as already done its duty or is not found
		throw new ConflictError(`Actor with ID ${aid} as already done is duty for this automat node)`) ;
	}

	let documentIndexes:number[] = [] ;
	for (let did of dids) {
		const dindex = node.dids.indexOf(did) ;
		if (dindex < 0) {
			throw new ConflictError(`Document ID ${did} was not found for this automat node)`) ;
		}
		if (node.done_dids.includes(did)) {
			throw new ConflictError(`Document ID ${did} was already done for this automat node)`) ;

		}
		documentIndexes.push(dindex) ;
		const waids = node.working_documents[dindex] ;
		if (waids.length >= node.concernedActors) {
			throw new ConflictError(`All needed actors have already signed or approved the document with IDfor this step`) ;
		}
		if (node.working_documents[dindex].includes(aid)) {
			throw new ConflictError(`The document with ID ${did} was already signed or approved by actor with ID ${aid}) for this step`) ;
		}
	}

	// here we have a valid action, a valid list of documents and a valid actor in a valid step
	// and the document has not already been signed by this actor
	let copy = { ...self } ; // we make a copy of ourself
	node = copy.nodes[index] ;

	// first we mark that the actor has take an action on these documents
	const didsCount = dids.length ;
	for (let i = 0 ; i < didsCount ; i++) {
		node.working_documents[documentIndexes[i]].push(aid) ;
	}

	// let move document ids from dids if they are fully signed
	const dn = node.dids.length ;
	let signedForAid = 0 ;
	let new_dids:DocumentList = [] ;
	let new_working_documents = [] ;
	let transformations = 0 ;

	// here we examine each working document to see
	// if the document is fully signed or not
	// If it's the case, we simple push the doc to done_dids
	// and mark that we have a structural transformation. If
	// it's not the case, we constitute a copy of our dids and
	// working_documents arrays we will use if we have at least
	// one structural transformation. This way we never use
	// array splice within the loop (it's always tricky in JS
	// since the Array is not automatically in indices orders)
	for (let i = 0 ; i < dn ; i++) {
		let wnode = node.working_documents[i] ;
		if (wnode.includes(aid)) {signedForAid ++ ; }
		if (wnode.length >= node.concernedActors) {
			// we need to remove the document from the list of document to be signed
			// and from workking_documents
			// ant put it in done documents
			node.done_dids.push(node.dids[i]) ;
			transformations++ ;
		}
		else {
			new_dids.push(node.dids[i]) ;
			new_working_documents.push(wnode) ;
		}
	}
	if (transformations > 0) {

		node.dids = new_dids ;
		node.working_documents = new_working_documents ;
	}

	// do the same with the actor : remove it from aids if it is done
	if (signedForAid >= node.concernedActors) {
		// the actor has done its dudy
		node.done_aids.push(aid) ;
		node.aids.splice(actorIndex, 0) ;
	}

	if (node.dids.length === 0) {
		// all documents have been "signed"
		// we move to the next step
		copy.index = index + 1 ;
	}
	return copy ;
}

function _automatSplitIndex(self:Automat) : number | null
{
	if (isAutomatAtEnd(self) || isAutomatAtStart(self)) return null ;
	const node = self.nodes[self.index] ;
	if (node.dids.length === 0) { return self.index + 1 ; } // at the end of current step we plit at the next one
	if (automatNodeWorkingDocuments(node) > 0) { return null ; } // we are in the middle of something
	return self.index ;
}

export function splitedAutomats(self:Automat) : { previous:Automat, next:Automat } | null
{
	const n = _automatSplitIndex(self) ;

	if (!$ok(n)) return null ;

	return {
		previous:{
			nodes:self.nodes.slice(0, <number>n),
			index: <number>n
		},
		next:{
			nodes:self.nodes.slice(<number>n),
			index:0
		}
	}
}
