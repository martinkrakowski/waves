/**
 * What a request on one of the two admin routes is allowed to do, decided from
 * the route, its query and which of the service's own tokens presented the
 * digest. Both functions are pure and read nothing: the table below is the whole
 * of the policy, so a review reads one screen rather than a request pipeline.
 *
 * There are two service tokens and they are not the same power. The admin token
 * does everything; the enrollment token may create a project that does not exist
 * yet and nothing else — no rotation, no removal, no wave — so a copy of it that
 * leaks can add a project and cannot take one away or learn an existing token.
 */

/** Which of the two configured tokens a presented digest matched. */
export type TokenKind = "admin" | "enroll" | "none";

export type Authorization =
  | { readonly kind: "admin" }
  | { readonly kind: "enroll" }
  | { readonly kind: "refuse"; readonly status: 401 | 403 };

/**
 * | route         | rotate | token  | answer      |
 * | ------------- | ------ | ------ | ----------- |
 * | any           | any    | none   | refuse 401  |
 * | register      | false  | admin  | admin       |
 * | register      | false  | enroll | enroll      |
 * | register      | true   | admin  | admin       |
 * | register      | true   | enroll | refuse 403  |
 * | removeProject | —      | admin  | admin       |
 * | removeProject | —      | enroll | refuse 403  |
 *
 * `rotate` does not decide a removal: a `DELETE` with a query is refused as a bad
 * query before this is reached, so the two rows for it are the same row. Both
 * refusals are charged to the address's failure window, so a caller that keeps
 * asking spends the same allowance as one that keeps guessing a token.
 */
export function authorize(
  route: "register" | "removeProject",
  rotate: boolean,
  token: TokenKind,
): Authorization {
  if (token === "none") {
    return { kind: "refuse", status: 401 };
  }
  if (token === "admin") {
    return { kind: "admin" };
  }
  if (route === "removeProject" || rotate) {
    return { kind: "refuse", status: 403 };
  }
  return { kind: "enroll" };
}

/**
 * Whether a route exists at all, which is a different question from whether this
 * request may use it: a route no configured token could ever authorize is gone
 * rather than locked, and answers 404 exactly as a path that never existed does.
 *
 * | route         | rotate | answer                                      |
 * | ------------- | ------ | ------------------------------------------- |
 * | register      | false  | `adminConfigured \|\| enrollConfigured`       |
 * | register      | true   | `adminConfigured`                            |
 * | removeProject | any    | `adminConfigured`                            |
 *
 * So `POST /api/v1/projects` is 404 only when neither token is configured, and
 * `?rotate=1` and `DELETE` are 404 whenever the admin token is not — which is why
 * the query is read before this is asked.
 */
export function adminRouteEnabled(
  route: "register" | "removeProject",
  rotate: boolean,
  adminConfigured: boolean,
  enrollConfigured: boolean,
): boolean {
  if (route === "removeProject") {
    return adminConfigured;
  }
  return rotate ? adminConfigured : adminConfigured || enrollConfigured;
}
