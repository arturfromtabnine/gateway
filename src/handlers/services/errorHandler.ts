import { Response } from 'hono';
import { GatewayError } from '../../errors/GatewayError';
import { RouterError } from '../../errors/RouterError';
import { ERROR_MESSAGES, HTTP_STATUS, REQUEST_PROCESSING } from '../constants';

export class RequestErrorHandler {
  /**
   * Handles errors that occur during request processing in tryPost
   */
  static handleTryPostError(error: any): Response {
    console.error('tryPost error:', error.message, error.cause, error.stack);
    
    const errorMessage = error instanceof GatewayError 
      ? error.message 
      : ERROR_MESSAGES.SOMETHING_WENT_WRONG;
      
    return new Response(
      JSON.stringify({
        status: 'failure',
        message: errorMessage,
      }),
      {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: {
          'content-type': REQUEST_PROCESSING.DEFAULT_CONTENT_TYPE,
          [REQUEST_PROCESSING.GATEWAY_EXCEPTION_HEADER]: 'true',
        },
      }
    );
  }

  /**
   * Handles errors that occur during target recursion
   */
  static handleTargetRecursionError(error: any): Response {
    console.error('tryTargetsRecursively error:', error.message, error.cause, error.stack);
    
    const errorMessage = error instanceof GatewayError
      ? error.message
      : ERROR_MESSAGES.SOMETHING_WENT_WRONG;

    return new Response(
      JSON.stringify({
        status: 'failure',
        message: errorMessage,
      }),
      {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: {
          'content-type': REQUEST_PROCESSING.DEFAULT_CONTENT_TYPE,
          [REQUEST_PROCESSING.GATEWAY_EXCEPTION_HEADER]: 'true',
        },
      }
    );
  }

  /**
   * Handles router-specific errors
   */
  static handleRouterError(error: RouterError): Response {
    console.error('Router error:', error.message);
    
    return new Response(
      JSON.stringify({
        status: 'failure',
        message: error.message,
      }),
      {
        status: HTTP_STATUS.BAD_REQUEST,
        headers: {
          'content-type': REQUEST_PROCESSING.DEFAULT_CONTENT_TYPE,
        },
      }
    );
  }

  /**
   * Creates a hooks failure response
   */
  static createHooksFailureResponse(hookResults: any, startTime: Date): Response {
    return new Response(
      JSON.stringify({
        error: {
          message: ERROR_MESSAGES.HOOKS_FAILED,
          type: 'hooks_failed',
          param: null,
          code: null,
        },
        hook_results: {
          before_request_hooks: hookResults,
          after_request_hooks: [],
        },
      }),
      {
        status: HTTP_STATUS.HOOKS_FAILED,
        headers: { 
          'content-type': REQUEST_PROCESSING.DEFAULT_CONTENT_TYPE 
        },
      }
    );
  }

  /**
   * Logs and handles before request hook errors
   */
  static handleBeforeRequestHookError(error: any): { error: any } {
    console.error('beforeRequestHookHandler error:', error);
    return { error };
  }
}