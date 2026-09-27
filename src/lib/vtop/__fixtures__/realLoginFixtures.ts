/**
 * SANITIZED REAL VTOP Chennai login-page fixtures.
 *
 * Captured from https://vtopcc.vit.ac.in during pre-authentication
 * inspection (no credentials used). ALL secrets redacted:
 *   - _csrf values -> CSRF_TOKEN_REDACTED
 *   - CAPTCHA image data -> CAPTCHA_IMAGE_REDACTED
 *   - UUIDs -> UUID_REDACTED
 * No student credentials or session cookies are present.
 *
 * These capture REAL portal structure. Regression tests must keep passing
 * against them — if VTOP changes its structure, these tests will catch it.
 */

export const realLoginFormHtml = `<form id="vtopLoginForm" name="vtopLoginForm" class="form-signin" method="POST"
                                action="/vtop/login"><input type="hidden" name="_csrf" value="CSRF_TOKEN_REDACTED"/>

                                <!-- USERID -->

                                <div class="input-group input-group-sm mb-3">
                                    <input type="text" class="form-control" placeholder="Username" aria-label="Username"
                                        aria-describedby="basic-addon1" id="username" name="username"
                                        onkeyup="this.value = this.value.toUpperCase()" autocomplete="off">
                                    <span class="input-group-text" id="basic-addon1"><i class="fa fa-user text-primary"
                                            aria-hidden="true"></i></span>
                                </div>

                                <!-- PASSWORD -->

                                <div class="input-group input-group-sm mb-3">
                                    <input type="password" class="form-control" placeholder="Password" id="password"
                                        name="password" aria-describedby="basic-addon2">
                                    <button id="basic-addon2" class="btn btn-light border-secondary" type="button">
                                        <i class="fa fa-eye text-danger fw-bold" id="passwordIcon"
                                            onclick="javascript:toggleEye();" aria-hidden="false"></i>
                                    </button>
                                </div>

                                <!-- IN BUILT CAPTCHA  -->

                                

                                    <div class="row">
                                        <div class="col-7 mx-auto">
                                            <div class="input-group input-group-sm border  mb-3" id="captchaBlock">
                                                

                                                    <img class="form-control img-fluid bg-light border-0" height="325"
                                                        src="data:image/jpeg;base64,CAPTCHA_IMAGE_REDACTED"
                                                        aria-describedby="button-addon2" />

                                                    <button class="btn btn-success" type="button"
                                                        onclick="loadCaptcha()" id="button-addon2"> <i
                                                            class="fa fa-refresh" aria-hidden="true"></i></button>
                                                
                                            </div>
                                        </div>
                                    </div>
                                    <div class="mb-3">
                                        <input type="text" class="form-control form-control-sm" autocomplete="off"
                                            maxlength="6" onkeyup="this.value = this.value.toUpperCase()"
                                            id="captchaStr" name="captchaStr" aria-describedby="captchaHelp"
                                            placeholder="Enter CAPTCHA shown above">
                                    </div>
                                

                                <!-- GOOGLE CAPTCHA  -->

                                

                                <button
                                    type="button" onclick="javascript:callBuiltValidation();" id="submitBtn"
                                    class="btn btn-sm btn-primary float-end">Submit</button>

                                
                            </form>`;

export const realRoleChooserHtml = `<form class="text-center" id="stdForm" action="/vtop/prelogin/setup" method="post"><input type="hidden" name="_csrf" value="CSRF_TOKEN_REDACTED"/>
                    <input type="hidden" name="flag" value="VTOP" />
                    <a href="javascript:void(0);" class="text-decoration-none"
                        onclick="javascript:submitForm('stdForm')">
                         <div class="circle">
                          <img src="/vtop/assets/img/students.png" class="img-responsive center imgSiz" id="student"
                                    alt="..." />
                                              
                                <p>Student</p>
                                <div class="fw-bold text-primary d-none d-lg-block h5"></div>
                                                           
                            
                        </div>
                    </a>
                </form>
<form id="sessionExpireCheckForm" action="/vtop/session/expired/out">

        </form>`;

export const realCaptchaFragmentHtml = `

                                                    <img class="form-control img-fluid bg-light border-0" height="325"
                                                        src="data:image/jpeg;base64,CAPTCHA_IMAGE_REDACTED"
                                                        aria-describedby="button-addon2" />

                                                    <button class="btn btn-success" type="button"
                                                        onclick="loadCaptcha()" id="button-addon2"> <i
                                                            class="fa fa-refresh" aria-hidden="true"></i></button>
                                                `;

export const realLoginErrorExcerptHtml = `                  placeholder="Enter CAPTCHA shown above">
                                    </div>
                                

                                <!-- GOOGLE CAPTCHA  -->

                                

                                <button
                                    type="button" onclick="javascript:callBuiltValidation();" id="submitBtn"
                                    class="btn btn-sm btn-primary float-end">Submit</button>

                                
                            </form>
                        </div>
                        <span class="text-danger text-center" role="alert">
                            <strong> Invalid Captcha </strong>
                        </span>
                        

                        <div class="card-footer border-0 small">
                            <a class="fw-bold `;
