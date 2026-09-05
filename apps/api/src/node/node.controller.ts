import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  accessRequest, assertHttpBinding, parseNodeRequest, protocolError, NodeProtocolError,
  NODE_REQUEST_MAX_BYTES, NODE_PRINCIPAL_HEADER, NODE_VERSION_HEADER,
} from '@workspace/node-protocol';
import { type Request } from 'express';
import { CurrentUser } from '../auth/auth-context';
import { HostedNodeAccess } from './hosted-node-access';

/** OpenAPI comes from the shared, versioned transport schema, not a second DTO. */
@ApiExcludeController()
@Controller('api/v1/node')
export class NodeController {
  constructor(
    @Inject(HostedNodeAccess)
    private readonly access: Pick<HostedNodeAccess, 'forOwner'>,
  ) {}

  @Post('requests')
  @HttpCode(HttpStatus.OK)
  async request(
    @CurrentUser()
    userId: string,
    @Body()
    body: Record<string, unknown>,
    @Req()
    request: Pick<Request, 'headers'>,
    @Res({ passthrough: true })
    response: {
      setHeader(name: string, value: string): void;
      once(event: 'close', listener: () => void): void;
      off(event: 'close', listener: () => void): void;
    },
  ) {
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    response.once('close', disconnect);
    response.setHeader('Cache-Control', 'no-store');
    let id: string | null = null;
    try {
      if (Buffer.byteLength(JSON.stringify(body)) > NODE_REQUEST_MAX_BYTES) {
        throw new NodeProtocolError('request_limit', 'Node request is too large.', -32600);
      }
      const input = parseNodeRequest(body); id = input.id;
      assertHttpBinding(userId, request.headers[NODE_PRINCIPAL_HEADER], request.headers[NODE_VERSION_HEADER], input.method);
      return await accessRequest(input, this.access.forOwner(userId),
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]));
    } catch (error) {
      return { jsonrpc: '2.0', id, error: protocolError(error) };
    } finally { response.off('close', disconnect); }
  }
}
