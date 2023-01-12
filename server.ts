/*
    APIServer holds the server class
    It loads the configuration and holds the server itself
    Configuration Singleton class
*/
import { ObjectDictionary } from "foundation-ts/types";
import { $ok, $length, $count, $isstring, $isnumber, $strings, $unsigned } from 'foundation-ts/commons'
import { $trim } from 'foundation-ts/strings'
import { $createDirectory, $isdirectory, $isfile, $path, $loadJSON } from 'foundation-ts/fs'
import { $uuid } from 'foundation-ts/crypto';
import { $inspect, $logterm } from 'foundation-ts/utils';
import { DEFAULT_PATH } from './utils/commons'; 

import { $now, $timeBetweenDates, $exit } from "./utils/commons";
import {
    BadRequestError,
    BOOT_ERROR,
    HTTPClientError,
    DatabaseError,
    InternalError,
} from "./utils/errors";

import Knex from 'knex';
import { Model } from "objection";
import fastify, {
    FastifyInstance,
    FastifyRequest,
    FastifyReply,
} from "fastify";
import { Server, IncomingMessage, ServerResponse } from "http";

import {
    AuthHeaders,
    APIRawMimeTypes,
    RoleType,
    SigningProcess,
    UserRole,
    APIRole,
    AcceptedLanguages,
    APIFileType,
    APIFileInfos,
    AuthType,
} from "./api/APIConstants";
import CertificationAuthority, {
    ImportedCA,
} from "./model/CertificationAuthority";
import { Config, DBConnection, SignServerLogin } from "./server-config";
import { APIAuth } from "./api/APIInterfaces";
import RequestLog from "./model/RequestLog";
import { apiGlobals } from "./model/DBConstants";
import { Manifest } from "./classes/Manifest";
import { Certigna } from "./classes/CertignaEndPoint";
import { RequestInterface } from "./model/DBInterfaces";
import { GenericLoggerInterface } from "./classes/GenericLogger";
import * as env from "./env-config";

type LocalLoggerOptions =
    | boolean
    | {
        level?: string;
        prettyPrint?: boolean;
        timestamp?: boolean;
        name?: string;
    };

function _actualPath(p: string, message: string): string {
    if (!$createDirectory(p)) {
        throw new Error(message);
    }
    return p;
}

function _verifyPath(
    p: string,
    defaults: string[],
    type: string,
    mkdir: boolean,
    verbose?: boolean
): string {
    p = $path($ok(p) ? p : DEFAULT_PATH, ...defaults);
    if (!!verbose) {
        $logterm(`&w${type} path:'&g${p}&w'&0`);
    }
    if (!$isdirectory(p)) {
        if (!mkdir || !$createDirectory(p)) {
            throw new Error(`${type} path '${p}' is not found or not writable.`);
        }
    }
    return p;
}

interface RequestNode {
    date: string;
    auth: APIAuth;
    response?: any;
}

type RequestDictionary = { [key: string]: RequestNode };

export class APIServer implements GenericLoggerInterface {
    conf: Config;
    apiName: string = "api-ng";
    version: string = "/v1";
    prefix: string = "/api";
    approvalKeys: string[];
    downloadsPathFiles: string;
    downloadsPathSeals: string;
    storagePathFiles: string;
    storagePathSeals: string;
    storagePathTemp: string;
    uploadsPathFiles: string;
    uploadsPathSeals: string;
    currentRequests: RequestDictionary;

    readonly server: FastifyInstance<Server, IncomingMessage, ServerResponse>;
    public static readonly developerAKI: string = "142857999";

    private static defaultApprovalRoles: string[] = ["approval"];
    private static defaultSendingRoles: string[] = ["to", "cc"];
    private static defaultSignatureRoles: string[] = [
        SigningProcess.Sign,
        SigningProcess.Cosign,
        SigningProcess.Countersign,
        SigningProcess.OrderedCosign,
        SigningProcess.IndividualSign,
    ];
    private static instance: APIServer; // the private singleton var
    static acceptedRawBufferURLs: string[];
    static verbose: boolean;

    // CAUTION: keep the constructor private
    // if you want to enforce the singleton pattern
    private constructor(jsonConfig: any) {
        // here we make sure we have the proper defaults for the API even
        // if we have no proper configuration file

        if (!$ok(jsonConfig)) {
            jsonConfig = {};
            $logterm(`&o*** Warning *** : &wNO JSON configuration file passed to ${this.apiName}&0`);
        }
        this.currentRequests = {};
        this.conf = new Config(jsonConfig); // this validates our configuration file
        APIServer.verbose = this.conf.isProduction ? false : true;
        this.conf.downloadsPath = _verifyPath(
            this.conf.downloadsPath,
            ["run", "downloading_files"],
            "Download",
            true,
            APIServer.verbose
        );
        this.conf.storagePath = _verifyPath(
            this.conf.storagePath,
            ["run", "stored_files"],
            "Storage",
            true,
            APIServer.verbose
        );
        this.conf.uploadsPath = _verifyPath(
            this.conf.uploadsPath,
            ["run", "uploaded_files"],
            "Upload",
            true,
            APIServer.verbose
        );
        //this.conf.sealCertificateFolder =   _verifyPath(this.conf.sealCertificateFolder, ['conf', 'seal'], 'Seal', false, APIServer.verbose) ;

        // initializing manifest template file
        const templatePath = $isfile(this.conf.manifestTemplatePath)
            ? this.conf.manifestTemplatePath
            : $path(DEFAULT_PATH, "conf", "manifest-model.html") ;
        if (!$ok(Manifest.producer(<GenericLoggerInterface>this).addTemplateFile(templatePath))) {
            throw new Error(
                `Unable to initialize manifest template file: '${templatePath}'`
            );
        }

        this.downloadsPathFiles = _actualPath(
            $path(this.conf.downloadsPath, "files"),
            "Impossible to find or create files download directory."
        );
        this.downloadsPathSeals = _actualPath(
            $path(this.conf.downloadsPath, "seals"),
            "Impossible to find or create seals download directory."
        );
        this.storagePathFiles = _actualPath(
            $path(this.conf.storagePath, "files"),
            "Impossible to find or create files storage directory."
        );
        this.storagePathSeals = _actualPath(
            $path(this.conf.storagePath, "seals"),
            "Impossible to find or create seals storage directory."
        );
        this.storagePathTemp = _actualPath(
            $path(this.conf.storagePath, "temp"),
            "Impossible to find or create temporary storage directory."
        );
        this.uploadsPathFiles = _actualPath(
            $path(this.conf.uploadsPath, "files"),
            "Impossible to find or create files upload directory."
        );
        this.uploadsPathSeals = _actualPath(
            $path(this.conf.uploadsPath, "seals"),
            "Impossible to find or create seals upload directory."
        );

        if (!$ok(this.conf.signServerLogin)) {
            this.conf.signServerLogin = new SignServerLogin({
                login: env.SIGN_SERVER_LOGIN,
                password: env.SIGN_SERVER_PASS,
            });
        }

        let doubles: string[] = [];
        this.approvalKeys = [...APIServer.defaultApprovalRoles];
        for (let k in this.conf.approvalRoles) {
            if (APIServer.defaultApprovalRoles.includes(k)) {
                doubles.push(k);
            } else {
                this.approvalKeys.push(k);
            }
        }
        if ($count(doubles)) {
            throw new Error(
                `Found double documents' approval roles: (${doubles.join(", ")})`
            );
        }

        // initializing of the Postgres database
        if (!$ok(this.conf.dbConnection)) {
            if (this.conf.isProduction) {
                throw new Error(
                    `No database connection specified in api-ng configuration file.`
                );
            } else {
                // In developer mode we have a standard database connection

                this.conf.dbConnection = new DBConnection({
                    host: env.DB_HOST,
                    port: env.DB_PORT,
                    user: env.DB_USER,
                    password: env.DB_PASS,
                    database: env.DB_NAME,
                });

                $logterm(`&yDefault database configuration used&0`);
            }
        }
        const loggerOptions: boolean | LocalLoggerOptions =
            this.conf.logLevel === "off"
                ? false
                : {
                    name: this.apiName, // WARNING: not sure if it even works with fastify
                    level: this.conf.logLevel,
                    timestamp: true,
                };

        if (APIServer.verbose) {
            $logterm("&x************** &yCONFIGURATION&x *************************&0");
            $logterm(`&xLaunching with default path '&g${DEFAULT_PATH}&x'&0`);
            $logterm(
                `&xConfiguration:\n&g${$inspect({
                    approvals: this.approvalKeys,
                    conf: this.conf,
                    "fastify-logger-options": loggerOptions,
                })}&0`
            );
            $logterm("&x******************************************************&0");
        }

        if (APIServer.verbose) {
            $logterm(
                `&xConnect to database with credentials:\n&g${$inspect(
                    this.conf.dbConnection
                )}&x ...&0`
            );
        }
        const knex = Knex({
            client: env.DB_CLIENT,
            // useNullAsDefault: true,
            connection: this.conf.dbConnection,
        });
        Model.knex(knex);
        if (APIServer.verbose) {
            $logterm("&G&w connected &0");
        }
        let caImports: ImportedCA[] = [];

        if ($count(this.conf.certificationAuthorities)) {
            caImports = this.conf.certificationAuthorities.map((def) => {
                return {
                    aki: def.aki,
                    uuid: def.uuid,
                    name: def.name,
                    longName: def.longName,
                    cguVersion: def.cguVersion,
                };
            });
        } else {
            caImports = [
                {
                    uuid: "878043EA-3687-49F3-A018-430EE293CC06",
                    name: "DeveloperCA",
                    longName: "Developer Certification Authority",
                    aki: APIServer.developerAKI,
                    cguVersion: "1.0",
                    cguLocalPath: $path(DEFAULT_PATH, "conf", "developer-ca-cgu.pdf"),
                },
            ];
        }
        if (APIServer.verbose) {
            $logterm("&xVerifying and importing Certification Authorities...&0");
        }
        CertificationAuthority.synchronizeCertificationAuthorities(caImports);
        if (APIServer.verbose) {
            $logterm("&G&w Done &0");
        }

        // here we assign the fastify server for our API
        if (APIServer.verbose) {
            $logterm("&xConfiguring Fastify Server...&0");
        }

        this.server = fastify({ logger: loggerOptions, trustProxy: true });

        // we add the raw-body management for the uploads
        APIServer.acceptedRawBufferURLs = [
            `${this.prefix}${this.version}/uploads`,
            `${this.prefix}${this.version}/dev/sign-document`,
        ];
        APIRawMimeTypes.forEach((mt) => {
            this.server.addContentTypeParser(
                mt,
                { parseAs: "buffer" },
                function (request, rawBody, done) {
                    let url = request.url.toLowerCase();
                    const n = url.indexOf("?");
                    if (n >= 0) {
                        url = url.slice(0, n);
                    }

                    if (!$length(url)) {
                        done(
                            new BadRequestError(
                                "malformed URL cannot manage raw body in non-post requests"
                            ),
                            undefined
                        );
                    } else if (request.method !== "POST") {
                        done(
                            new BadRequestError(
                                "cannot manage raw body in non-post requests"
                            ),
                            undefined
                        );
                    } else if (!APIServer.acceptedRawBufferURLs.includes(url)) {
                        done(
                            new BadRequestError(`cannot manage raw body on request '${url}'`),
                            undefined
                        );
                    }
                    done(null, rawBody);
                }
            );
            if (APIServer.verbose) {
                $logterm(`&xAdded mime type '&g${mt}&x' parser&0`);
            }
        });

        let self = this;
        this.server.addHook("onResponse", async (request, reply) => {
            await self._registerRequest(request, reply); // there's no error here
        });

        // we want to manage database and user action errors here
        this.server.addHook("onError", async (_, reply, error) => {
            if (error instanceof HTTPClientError) {
                reply.code(error.statusCode).send({ error });
            } else if (this.conf.isProduction) {
                reply.code(500).send({ error });
            } else {
                reply.code(500).send({
                    name: "INTERNAL_SERVER_ERROR",
                    message: "Internal Server Error.",
                    statusCode: 500,
                });
            }
        });

        this.server.ready((e) => {
            if (e) {
                $exit(
                    `\nFastify server encountered error ${e.message} during booting process`,
                    BOOT_ERROR
                );
            } else if (APIServer.verbose) {
                $logterm("&G&w Fastify server correctly booted! &0");
            }
        });

        // parameters for Certigna End Point
        let endPoint = Certigna.endPoint(<GenericLoggerInterface>this);
        endPoint.timeOut = this.conf.externalRequestsTimeout;
        endPoint.certificateGenerationTimeOut = this.conf.certificateRequestsTimeout;
        endPoint.signatureGenerationTimeOut = this.conf.signatureRequestsTimeout;
    }

    // returns undefined means the role was empty or filled with spaces
    // returns null means we don't know this role
    // returns a string means we found the role and return its canonical version
    public roleType(s: string | null | undefined): RoleType | undefined | null {
        if (!$length(s)) return undefined;
        s = $trim(s);
        if (!$length(s)) {
            return undefined;
        }
        s = s.toLowerCase();
        if (APIServer.defaultSignatureRoles.includes(s)) return RoleType.Signature;
        if (this.approvalKeys.includes(s)) return RoleType.Approval;
        if (APIServer.defaultSendingRoles.includes(s)) return RoleType.Expedition;
        return null;
    }

    static __logNumber: number = 0;
    public log(log: any) {
        $logterm(`&o++++++++++ api log ${++APIServer.__logNumber} ++++++++++&y\n${$inspect(log)}&o\n++++++++++`);
        //this.server.log.info(log) ;
    }

    public error(log: any) {
        this.log(log);
        //this.server.log.error(log) ;
    }

    public temporaryFile(type: APIFileType) {
        return $path(
            this.storagePathTemp,
            `${$uuid()}.${APIFileInfos[type].extensions[0]}`
        );
    }

    public url(
        root: string,
        rootID: number | string,
        node?: string | null | undefined,
        nodeID?: number | string | null | undefined
    ) {
        let base = this.conf.longIdentifiers
            ? `${this.prefix}${this.version}/${root}/${rootID}`
            : `${root}/${rootID}`;
        if (!$length(node)) {
            return base;
        }
        return $ok(nodeID) ? `${base}/${node}/${nodeID}` : `${base}/${node}`;
    }

    private _checkRole(
        s: string | null | undefined,
        sign: boolean,
        approval: boolean,
        send: boolean
    ): [string, number] {
        if (!$length(s)) return ["", -2];
        s = $trim(s);
        if (!$length(s)) {
            return ["", -2];
        }
        s = s.toLowerCase();
        if (sign && APIServer.defaultSignatureRoles.includes(s)) {
            return [s, AuthType.Authorized];
        }
        if (approval && this.approvalKeys.includes(s)) {
            return [s, AuthType.Authorized];
        }
        if (send && APIServer.defaultSendingRoles.includes(s)) {
            return [s, AuthType.Refused];
        }
        return [s, -1];
    }

    public checkRoles(
        roles: string[] | string | null | undefined,
        sign: boolean,
        approval: boolean,
        send: boolean
    ): {
        roles: string[];
        rejecteds: string[];
        nulls: number;
        authType: AuthType;
    } {
        let a = $strings(roles);
        let nullRoles = 0;
        let goodRoles: string[] = [];
        let badRoles: string[] = [];
        let atype = AuthType.Refused;
        if ($count(a)) {
            a.forEach((s) => {
                let [role, authType] = this._checkRole(s, sign, approval, send);
                switch (authType) {
                    case -2:
                        nullRoles++;
                        break;
                    case -1:
                        badRoles.push(s);
                        break;
                    default:
                        goodRoles.push(role);
                        if (authType != AuthType.Refused) {
                            atype = authType;
                        }
                        break;
                }
            });
        }
        return {
            roles: goodRoles,
            rejecteds: badRoles,
            nulls: nullRoles,
            authType: atype,
        };
    }

    public verifyManifestData(
        data: object | undefined | null,
        def: ObjectDictionary
    ): boolean {
        if ($ok(data)) {
            for (let k in data) {
                let a = def[k];
                if (!$ok(a)) return false;
            }
        }
        return true;
    }

    /* 
      if this methods is not called in onResponse hook
      it needs to be called with an undefined reply
  */
    private async _registerRequest(
        request: FastifyRequest,
        reply: FastifyReply | undefined,
        error?: HTTPClientError | undefined
    ) {
        const node = this.currentRequests[request.id];

        /*if (APIServer.verbose) {
                this.log(`-------------------------------------${request.id}`) ;
            }*/

        if (!$ok(node)) {
            // should not arrive, so we will throw and stop the circus here
            throw new InternalError(
                "_registerRequest() did fail : contact your system administrator"
            );
        }
        let message: string | undefined = undefined;
        let responseTime = 0;
        let status = 500;
        let response: any = undefined;

        if ($ok(error)) {
            const e = <HTTPClientError>error;
            status = e.statusCode || 500;
            message = e.message;
            if ($length(message) > apiGlobals.messageLength)
                message = (<string>message).slice(0, apiGlobals.messageLength);
        } else if ($ok(reply)) {
            const r = <FastifyReply>reply;
            responseTime = Math.ceil(r.getResponseTime());
            status = r.statusCode;
            response = node.response;
        }
        if (!responseTime) {
            responseTime = Math.ceil($timeBetweenDates(node.date, $now()));
        }
        /*if (APIServer.verbose) {
                this.log(`Will register request ${request.id} done in ${responseTime}ms with status ${status} and ${$length(message)?'error':($ok(response) ? 'response' : 'nothing')}`) ;
            }*/
        let localError = undefined;
        //this.log('Before transaction') ;
        try {
      /*let returnValue =*/ await RequestLog.transaction(async (trx) => {
            const log: RequestInterface = {
                requestId: request.id,
                apiRole: node.auth.apiRole,
                user: node.auth.user,
                role: node.auth.role,
                requestMethod: request.method,
                requestUrl: request.url,
                date: node.date,
                duration: responseTime,
                ip: request.ip,
                status: status,
                request: {
                    params: request.params,
                    headers: request.headers,
                    query: request.query,
                    body: request.body,
                },
                reply: {
                    headers: reply?.getHeaders(),
                    body: response,
                },
                error: message,
            };
            //this.log(`WILL INSERT REQUEST LOG`) ;
            const insertedRequestLog = await RequestLog.query(trx).insert(log);
            //this.log('DONE') ;
            if (!$ok(insertedRequestLog)) {
                throw new DatabaseError("Impossible to register request log");
            }
            //this.log('WILL RETURN FROM TRANSACTION') ;
            return insertedRequestLog;
        });
            //this.log(`Request ${request.id} logged under ${returnValue?.id} identifier`) ;
        } catch (e) {
            this.log(`Did encounter error:${e.message}`);
            localError = e;
        } finally {
            //this.log('finally') ;
            delete this.currentRequests[request.id];
        }
        /*this.log('after') ;
    
            if (APIServer.verbose) {
                this.log(`<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<${request.id}`) ;
            }*/
        if ($ok(localError)) {
            this.log(
                "_registerRequest() logging request did fail : contact your system administrator"
            );
            throw localError;
        }
    }

    public logError(e: Error) {
        this.log(
            `!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\nServer did encounter error '${e.name}' : '${e.message}'\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`
        );
    }

    public async requestError(reply: FastifyReply, e: HTTPClientError) {
        await this._registerRequest(reply.request, undefined, e);
        if (APIServer.verbose) {
            this.logError(e);
        }
        reply.code(e.statusCode || 500).send({ e });
    }

    public jsonReply<T>(reply: FastifyReply, statusCode: number, json: T) {
        const node = this.currentRequests[reply.request.id];
        if (!$ok(node)) {
            // should not arrive, so we will throw and stop the circus here
            throw new InternalError(
                "jsonReply() did fail : contact your system administrator"
            );
        }
        node.response = json; // we keep our json object until the onResponse hook
        reply.code(statusCode).send(json);
    }

    private _essentialVerifyRequest(
        request: FastifyRequest,
        params: string[],
        apiRole: APIRole
    ): APIAuth | null {
        // we check the mandatory authentification headers to prepare the APIAuth structure
        const userId = request.headers[AuthHeaders.Id];
        if (!$isstring(userId) || !$length(<string>userId)) {
            return null;
        }

        const userPassword = request.headers[AuthHeaders.Password];
        if (!$isstring(userPassword) || !$length(<string>userPassword)) {
            return null;
        }

        const roleHeader = request.headers[AuthHeaders.Role];
        if (!$isnumber(roleHeader) && !$isstring(roleHeader)) {
            return null;
        }

        const userRole = $unsigned(<number | string>roleHeader);
        if (!userRole || !Object.values(UserRole).includes(userRole)) {
            return null;
        }

        let language: any = request.headers[AuthHeaders.Language];
        if (!$isstring(language)) {
            return null;
        }
        language = $trim(<string>language).toLowerCase();
        if (
            !$length(<string>language) ||
            !Object.values(AcceptedLanguages).includes(language)
        ) {
            language = this.conf.language;
        }
        if (!$length(<string>language)) {
            language = AcceptedLanguages.FR;
        }

        if ($count(params)) {
            for (let pkey of params) {
                const p: unknown = (<any>request.params)[pkey];
                if (!$isnumber(p) && !$isstring(p)) {
                    return null;
                }
            }
        }

        return {
            user: <string>userId,
            role: <UserRole>userRole,
            password: <string>userPassword,
            apiRole: apiRole,
            language: <AcceptedLanguages>language,
        };
    }
    public prepareRequest(
        request: FastifyRequest,
        reply: FastifyReply,
        params: string | string[] = [],
        apiRole: APIRole = APIRole.Reading
    ): APIAuth {
        const auth = this._essentialVerifyRequest(
            request,
            $strings(params),
            apiRole
        );

        this.currentRequests[request.id] = {
            date: $now(),
            auth: <APIAuth>auth,
        };

        if (!$ok(auth)) {
            throw new BadRequestError("Bad Request Query or URL parameters");
        }

        if (APIServer.verbose) {
            this.log(`${request.id}>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
            this.log(`did receive request: ${request.method} ${$inspect(request.url)}`);
            this.log(`params:${$inspect(request.params)}`);
            this.log(`query:${$inspect(request.query)}`);
            this.log(`headers:${$inspect(request.headers)}`);
            if (
                $ok(request.headers) &&
                request.headers["content-type"] === "application/json"
            ) {
                const size = $unsigned(request.headers["content-length"]);
                if (size > 0) {
                    this.log(`body:${$inspect(request.body)}`);
                }
            }
            this.log(`${request.id}=====================================`);
        }
        reply.header("Cache-Control", "no-store");
        return <APIAuth>auth;
    }

    // static methods
    // this is the unique public method you use in order to get
    // the singleton
    public static api(file?: string | object): APIServer {
        if (!$ok(APIServer.instance)) {
            $logterm("&onot yet configured&0");
            let conf = undefined;
            if (!$ok(file) || $isstring(file)) {
                if (!$ok(file)) {
                    file = $path(DEFAULT_PATH, "conf", "ngconfig.json");
                }
                $logterm(`&x*** info *** :&w will load JSON configuration file '&g${file}&w'&0`);
                conf = $loadJSON(<string>file);
            } else {
                $logterm(`&x*** info *** :&w use test preloaded configuration&0`);
                conf = <object>file;
            }
            if (!$ok(conf)) {
                $logterm(`&o*** Warning *** :&w No valid JSON configuration file&0`);
                conf = {};
            }
            APIServer.instance = new APIServer(conf);
        }

        return APIServer.instance;
    }
}
