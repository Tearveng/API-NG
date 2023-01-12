import { $ok, $length, $count } from "foundation-ts/commons";
import { $hash, $uuid } from "foundation-ts/crypto";
import {
  $path,
  $removeFile,
  $writeBuffer,
  $writeString,
} from "foundation-ts/fs";

import { $now } from "../../utils/commons";
import { ForbiddenError, ConflictError, FileError } from "../../utils/errors";

import Upload from "../../model/Upload";

import { UserRole, APIMimeTypes, APIFileInfos } from "../APIConstants";
import { APIAuth, APIHeaders } from "../APIInterfaces";
import { APIServer } from "../../server";
import { APIGetListQuery } from "../APIInterfaces";
import { UploadInterface } from "../../model/DBInterfaces";
import { NO_CONTEXT } from "../../model/DBConstants";
import { Certigna } from "../../classes/CertignaEndPoint";
import { apiHeadersSchema } from "../APISchemas";

export interface UploadHeaders extends APIHeaders {
  "content-type": string;
}
export const UploadHeadersSchema = {
  ...apiHeadersSchema,
  "content-type": { type: "string" },
};

export const uploadFile = async (
  auth: APIAuth,
  mimeType: string,
  buffer: string | Buffer | undefined
): Promise<Upload> => {
  // WARNING: there is no specific authorization verification here.
  //       	everybody can upload, so you'd better not publish this
  //		 	api without any previous authent

  if (!$length(buffer) || !Buffer.isBuffer(buffer)) {
    throw new ConflictError(`No valid payload was send.`);
  }

  // here we have a valid raw Buffer payload
  const api = APIServer.api();
  let type = APIMimeTypes[mimeType];
  if (!$ok(type)) {
    throw new ConflictError(`Bad mime type ${mimeType}.`);
  }

  let extension = APIFileInfos[type].extensions[0];
  let fileBase = $uuid();
  const fileName = `${fileBase}.${extension}`;
  const filePath = $path(api.uploadsPathFiles, fileName);
  const sealPath = $path(api.uploadsPathSeals, `${fileBase}.xml`);

  if (!$writeBuffer(filePath, buffer)) {
    throw new FileError(`Impossible to save uploaded file.`);
  }
  const hash = $hash(buffer);
  const endPoint = Certigna.endPoint();
  const credentials = api.conf.signServerLogin;

  const uploadDate = $now();
  let seal = await endPoint.seal("pps#test", credentials.password, {
    name: fileName,
    user: auth.user,
    size: buffer.length,
    hash: hash,
    date: uploadDate, // date is mandatory here because we want the same date in our uploaded_date field
  });

  if (!$length(seal)) {
    throw new FileError(`Impossible to seal uploaded file.`);
  }
  if (!$writeString(sealPath, <string>seal)) {
    throw new FileError(`Impossible to save uploaded file seal.`);
  }

  let returnValue = undefined;
  try {
    // we open a transaction in order to close the session
    returnValue = await Upload.transaction(async (trx) => {
      let n = await Upload.nextGlobalPublicID({ trx: trx }); // this method updates NGConfig table
      let newUpload: UploadInterface = {
        publicId: n,
        fileType: type,
        hash: hash,
        path: filePath,
        size: buffer.length,
        ttl: api.conf.uploadTtl,
        uploaded_at: uploadDate,
        user: auth.user,
      };
      if ($length(sealPath)) {
        newUpload.sealPath = <string>sealPath;
      }
     
      let upload = await Upload.query(trx).insert(newUpload);
     
      return upload;
    });

    // here we have committed in the database
  } catch (e) {
    // here we have a rollback
    APIServer.api().error(e);
    throw e;
  }

  return returnValue;
};

export interface UploadListNode {
  publicId: number;
}

export const getUploadList = async (
  auth: APIAuth,
  q: APIGetListQuery
): Promise<string[]> => {
  // we have no specific authentification verification here because the query does it
  const query = Upload.expirationAwareListQuery<APIGetListQuery, Upload>(
    auth,
    q,
    NO_CONTEXT
  );
  if (auth.role === UserRole.Action) {
    // as action role, we get only our uploads
    query.where("user", "=", auth.user);
  }
  query.select("publicId").orderBy("publicId");

  let list = <UploadListNode[]>await query;
  const api = APIServer.api();

  return $count(list)
    ? list.map((n: UploadListNode) => api.url("upload", n.publicId))
    : [];
};

export const purgeUploads = async (auth: APIAuth): Promise<number> => {
  let n = 0;
  if (auth.role !== UserRole.Maintenance && auth.role !== UserRole.System) {
    throw new ForbiddenError(`Uploads cannot be purged by user ${auth.user}.`);
  }
  try {
    n = await Upload.transaction(async (trx) => {
      let total = 0;
      const now = $now();
      const uploads = await Upload.query(trx).where("expires_at", "<=", now);

      let files: string[] = [];
      if ($count(uploads)) {
        uploads.forEach((u) => u.fillPathsIn(files));
        await Upload.query(trx).delete().where("expires_at", "<=", now);
        files.forEach((p) => $removeFile(p));
      }
      return total;
    });
  } catch (e) {
    // here we have a rollback
    APIServer.api().error(e);
    throw e;
  }
  return n;
};
