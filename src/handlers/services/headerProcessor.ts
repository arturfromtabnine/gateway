import { env } from 'hono/adapter';
import { CONTENT_TYPES, HEADER_KEYS, POWERED_BY } from '../../globals';
import { REQUEST_PROCESSING } from '../constants';
import { RequestContext } from './requestContext';
import { HeaderProcessingOptions } from '../types';

export class HeaderProcessor {
  constructor(private requestContext: RequestContext) {}

  /**
   * Processes headers for proxy requests
   */
  processProxyHeaders(): Record<string, string> {
    if (this.requestContext.endpoint !== 'proxy') {
      return {};
    }

    const proxyHeaders: Record<string, string> = {};
    const poweredByHeadersPattern = REQUEST_PROCESSING.POWERED_BY_HEADER_PREFIX;
    const headersToIgnore = this.getHeadersToIgnore();

    Object.keys(this.requestContext.requestHeaders).forEach((key: string) => {
      if (
        !headersToIgnore.includes(key) &&
        !key.startsWith(poweredByHeadersPattern)
      ) {
        proxyHeaders[key] = this.requestContext.requestHeaders[key];
      }
    });

    return proxyHeaders;
  }

  /**
   * Processes forward headers based on configuration
   */
  processForwardHeaders(forwardHeaders: string[]): Record<string, string> {
    const forwardHeadersMap: Record<string, string> = {};

    forwardHeaders.forEach((header: string) => {
      const lowerCaseHeaderKey = header.toLowerCase();
      if (this.requestContext.requestHeaders[lowerCaseHeaderKey]) {
        forwardHeadersMap[lowerCaseHeaderKey] =
          this.requestContext.requestHeaders[lowerCaseHeaderKey];
      }
    });

    return forwardHeadersMap;
  }

  /**
   * Builds the final headers object combining all header sources
   */
  buildFinalHeaders(
    providerConfigMappedHeaders: Record<string, string>,
    forwardHeaders: string[]
  ): Record<string, string> {
    const baseHeaders = this.getBaseHeaders();
    const providerHeaders = this.processProviderHeaders(providerConfigMappedHeaders);
    const forwardHeadersMap = this.processForwardHeaders(forwardHeaders);
    const proxyHeaders = this.processProxyHeaders();

    let headers: Record<string, string> = {
      ...baseHeaders,
      ...providerHeaders,
      ...forwardHeadersMap,
      ...proxyHeaders,
    };

    return this.postProcessHeaders(headers);
  }

  /**
   * Gets the base headers for all requests
   */
  private getBaseHeaders(): Record<string, string> {
    const { requestHeaders } = this.requestContext;
    
    return {
      'content-type': REQUEST_PROCESSING.DEFAULT_CONTENT_TYPE,
      ...(requestHeaders['accept-encoding'] && {
        'accept-encoding': requestHeaders['accept-encoding'],
      }),
    };
  }

  /**
   * Processes provider-specific headers
   */
  private processProviderHeaders(providerConfigMappedHeaders: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {};

    Object.keys(providerConfigMappedHeaders).forEach((headerKey: string) => {
      headers[headerKey.toLowerCase()] = providerConfigMappedHeaders[headerKey];
    });

    return headers;
  }

  /**
   * Post-processes headers based on request method and content type
   */
  private postProcessHeaders(headers: Record<string, string>): Record<string, string> {
    const { method, endpoint: fn, requestHeaders } = this.requestContext;
    
    const contentType = headers['content-type']?.split(';')[0];
    const isGetMethod = method === 'GET';
    const isMultipartFormData = contentType === CONTENT_TYPES.MULTIPART_FORM_DATA;
    const shouldDeleteContentTypeHeader = (isGetMethod || isMultipartFormData) && headers;

    if (shouldDeleteContentTypeHeader) {
      delete headers['content-type'];
      
      if (fn === 'uploadFile') {
        headers['Content-Type'] = requestHeaders['content-type'];
        
        const filePurposeHeader = `x-${POWERED_BY}-file-purpose`;
        if (requestHeaders[filePurposeHeader]) {
          headers[filePurposeHeader] = requestHeaders[filePurposeHeader];
        }
      }
    }

    return headers;
  }

  /**
   * Gets the list of headers to ignore for proxy requests
   */
  private getHeadersToIgnore(): string[] {
    const { honoContext: c } = this.requestContext;
    const customHeadersToIgnore = env(c).CUSTOM_HEADERS_TO_IGNORE ?? [];
    
    const headersToIgnore = [
      ...customHeadersToIgnore,
      ...REQUEST_PROCESSING.HEADERS_TO_AVOID_CLOUDFLARE,
      'content-length',
    ];

    return headersToIgnore;
  }

  /**
   * Determines if request body should be processed based on content type and method
   */
  static shouldProcessRequestBody(
    requestContext: RequestContext,
    providerHeaders: Record<string, string>
  ): {
    isMultiPartRequest: boolean;
    isProxyAudio: boolean;
    shouldProcessAsJson: boolean;
  } {
    const headerContentType = providerHeaders[HEADER_KEYS.CONTENT_TYPE];
    const requestContentType = requestContext.getHeader(HEADER_KEYS.CONTENT_TYPE);

    const isMultiPartRequest =
      headerContentType === CONTENT_TYPES.MULTIPART_FORM_DATA ||
      (requestContext.endpoint === 'proxy' &&
        requestContentType === CONTENT_TYPES.MULTIPART_FORM_DATA);

    const isProxyAudio =
      requestContext.endpoint === 'proxy' &&
      requestContentType?.startsWith(CONTENT_TYPES.GENERIC_AUDIO_PATTERN);

    const shouldProcessAsJson = !isMultiPartRequest && !isProxyAudio && !!requestContentType;

    return {
      isMultiPartRequest,
      isProxyAudio,
      shouldProcessAsJson,
    };
  }
}