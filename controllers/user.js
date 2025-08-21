import { db_registrarNuevoUsuario, db_autenticarUsuario, db_cambiarPasswordUsuario, db_crearCodigoOTP, db_validarOTP, db_marcarOTPUsado, db_authGoogle, db_authGithub } from "../services/user.js";
import { email_OTP } from "./modules/email.mjs";
import bcrypt from 'bcrypt';
import crypto from 'crypto';
// import jwt from 'jsonwebtoken';
import { OAuth2Client } from "google-auth-library";
import { consoleLog } from "./modules/utils.mjs";


export async function login(req, res){
   try {
      const { email, password } = req.body;
      const result = await db_autenticarUsuario(email)
      if(!result.success){
         return res.status(404).json({success: false, message: "The user does not exist"})
      }
      if(!bcrypt.compareSync(password, result.user.password)) {
         return res.status(404).json({success: false, message: "The password is invalid"})
      }
      // Agregar una cookie con JWT para autenticar a los usuarios   
      const token = jwt.sign({ user: {
         id: result.user.id,
         email: result.user.email,
         name: result.user.name,
         lastname: result.user.lastname
      }}, process.env.KEY, { expiresIn: '1h' });

      return res.status(200).json({ success: true, token: token });
   } catch (error) {
      console.error('Ocurrio un error:',error);
      res.status(401).json({ success: false });
   }
}

export async function signup(req,res){
   try {
      const { email, password, name, lastname } = req.body;
      const currentDate = new Date();
      const userID = crypto.randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(password, 10);
      const fullName = name + " " + lastname;
      let user = {
         id: userID, email: email, name: fullName, given_name:name, lastname: lastname, 
         password: hashedPassword, created_date: currentDate, last_login: currentDate, 
         profile_picture: "", contenedores: [], otp: []
      }
      const response = await db_registrarNuevoUsuario(user);
      if(!response.success){
         return res.status(400).json({success: false, message: "Error al crear su cuenta de usuario. Inténtelo nuevamente"})
      }
      // Agregar una cookie con JWT para autenticar a los usuarios
      const token = jwt.sign({ user: {
         id: user.id,
         email: user.email,
         name: user.name,
         lastname: user.lastname
      }}, process.env.KEY, { expiresIn: '1m' });

      return res.status(200).json({success: true, token: token})
   } catch (error) {
      console.error('Ocurrio un error:',error);
      return res.status(400).json({ success: false });
   }
}

export async function logout(req,res){
   // Destruir la sesión y redirigir a la página de inicio de sesión
   req.session.destroy((err) => {
      if (err) {
         console.error('Error al destruir la sesión:', err);
         return res.status(500).json({success: false, message: "Ha ocurrido un error con su petición. Inténtelo nuevamente"})
      }
      res.clearCookie('AuthToken');
      return res.status(200).json({success: true})
   });
}

export async function cambiarPasswordUsuario(req,res){
   try {
      consoleLog("-----Cambiando contraseña-----");
      const { password, email } = req.body;
      const hashedPassword = await bcrypt.hash(password, 10);
      const response = await db_cambiarPasswordUsuario(email, hashedPassword)

      if (!response.success) {
         return res.status(401).json({ success: false, message: "No se pudo actualizar la contraseña" })
      }
      return res.status(200).json({ success: true })
   } catch (error) {
      console.error(error);
      // Enviar respuesta JSON indicando fallo
      res.status(401).json({ success: false });
   }
}

export async function generarOTP(req,res){
   try {
      const email = req.body.email;
      const response = await db_crearCodigoOTP(email)
      if (!response.success) return res.status(401).json({ success: false, messageCode: "Error al crear su cuenta de usuario. Inténtelo nuevamente" });
      const respuesta = await email_OTP(email,response.result.otp)
      if (!respuesta.success) return res.status(401).json({ success: false, message: "Error al generar código OTP. Inténtelo nuevamente" })
      const token = jwt.sign({ email: email }, process.env.KEY, { expiresIn: '30m' });

      return res.status(200).json({ success: true, token: token });
   } catch (error) {
      console.error(error);
      res.status(401).json({ success: false });
   }
}

export async function validarOTP(req,res){
   try {
      const { otp, email } = req.body;
      // const token = req.cookies.AuthToken;
      // const decoded = jwt.verify(token, process.env.KEY);
      const response = await db_validarOTP(email, otp)
      if (!response.success) return res.status(401).json({ success: false, message: "Error al crear su cuenta de usuario. Inténtelo nuevamente" })

      if (!Date.now() < response.timestamp) return res.status(401).json({ success: false, message: "El código de seguridad ha expirado. Inténtelo nuevamente" })
      if (otp !== response.result.otp.toString()) return res.status(401).json({ success: false, message: "El código de seguridad ingresado es incorrecto" })

      await db_marcarOTPUsado(email);
      return res.status(200).json({ success: true });
   } catch (error) {
      console.error(error);
      // Enviar respuesta JSON indicando fallo
      res.status(401).json({ success: false });
   }
}

export async function googleAuth(req, res){
   try {
      consoleLog("-------------Autenticando con Google-------------");
      const oAuth2Client = new OAuth2Client(
         process.env.GOOGLE_CLIENT_ID,
         process.env.GOOGLE_CLIENT_SECRET,
         'postmessage',
      );
      // Configura el token de acceso
      oAuth2Client.setCredentials({
         access_token: req.body.oauth
      });

      // Realiza una solicitud a la API de Google para obtener la información del usuario
      const url = 'https://www.googleapis.com/oauth2/v3/userinfo';
      const googleResponse = await oAuth2Client.request({ url });
      const userInfoGoogle = googleResponse.data;
      // Imprime la información del usuario
      //consoleLog("user google", userInfoGoogle);
      const response = await db_authGoogle(userInfoGoogle);
      if(!response.success){
         return res.status(401).json({success: false, message: "Error al crear su cuenta de usuario. Inténtelo nuevamente"})
      }
      // Agregar una cookie con JWT para autenticar a los usuarios
      const token = jwt.sign({ user: {
         id: response.user.id,
         email: response.user.email,
         name: response.user.name,
         profile_picture: response.user.profile_picture
      }}, process.env.KEY, { expiresIn: '1h' });
      return res.status(200).json({success: true, token: token})
   } catch (error) {
      console.error('Ocurrio un error:',error);
      // Enviar respuesta JSON indicando fallo
      return res.status(401).json({ success: false });
   }
}

export async function githubAuth(req, res){
   try {
      consoleLog("-------------Autenticando con GitHub-------------");
      const code = req.body.code;
      // consoleLog("------code",code)
      const githubToken = await getGithubToken(code);
      if(githubToken === undefined) return res.status(401).json({ success: false });
      ///consoleLog("githubToken",githubToken)
      const githubUser = await getGithubUser(githubToken);
      //consoleLog("githubUser",githubUser)
      const response = await db_authGithub(githubUser);
      // const result = await getUser(oauth.email)

      if(!response.success){
         return res.status(404).json({success: false, message: "The user does not exist"})
      }
      // if(!bcrypt.compareSync(password, result.user.password)) {
      //     return res.status(404).json({success: false, message: "The password is invalid"})
      // }
      // // Agregar una cookie con JWT para autenticar a los usuarios   
      const token = jwt.sign({ user: {
         id: response.user.id,
         email: response.user.email,
         name: response.user.name,
         profile_picture: response.user.profile_picture
      }}, process.env.KEY, { expiresIn: '1h' });
      // consoleLog("token",token);
      // res.cookie('AuthToken', token, { maxAge: 3 * 24 * 60 * 60 * 1000 });
      //req.session.user = { id: result.user.id, email: result.user.email };
      return res.status(200).json({ success: true, token: token });
   } catch (error) {
      console.error('Ocurrio un error:',error);
      // Enviar respuesta JSON indicando fallo
      res.status(401).json({ success: false });
   }
}

export async function linkedinAuth(req, res){
   try {
      consoleLog("-------------Autenticando con LinkedIn-------------");
      const code = req.body.code;

      const githubToken = await getGithubToken(code);
      ///consoleLog("githubToken",githubToken)
      const githubUser = await getGithubUser(githubToken);
      //consoleLog("githubUser",githubUser)
      const response = await authGithub(githubUser);
      // const result = await getUser(oauth.email)

      if(!response.success){
         return res.status(404).json({success: false, message: "The user does not exist"})
      }
      // if(!bcrypt.compareSync(password, result.user.password)) {
      //     return res.status(404).json({success: false, message: "The password is invalid"})
      // }
      // // Agregar una cookie con JWT para autenticar a los usuarios   
      const token = jwt.sign({ user: {
         id: response.user.id,
         email: response.user.email,
         name: response.user.name,
         profile_picture: response.user.profile_picture
      }}, process.env.KEY, { expiresIn: '1h' });
      //consoleLog("token",token);
      // res.cookie('AuthToken', token, { maxAge: 3 * 24 * 60 * 60 * 1000 });
      //req.session.user = { id: result.user.id, email: result.user.email };
      return res.status(200).json({ success: true, token: token });
   } catch (error) {
      console.error('Ocurrio un error:',error);
      // Enviar respuesta JSON indicando fallo
      res.status(401).json({ success: false });
   }
}

// Extra functions

async function getGithubToken(code){
   let token = '';
   const params = `?client_id=${process.env.GITHUB_CLIENT_ID}&client_secret=${process.env.GITHUB_CLIENT_SECRET}&code=${code}`;
   //consoleLog("-------params",params);
   await fetch(`https://github.com/login/oauth/access_token${params}`, {
      method: 'POST',
      headers: {
         'Accept': 'application/json'
      }
   }).then((response) => { 
      return response.json()
   }).then((data) => {
      //consoleLog(data)
      consoleLog("getGithubToken",data.access_token);
      token = data.access_token;
   }).catch((error) => {
      console.error('Error:', error);
   })
   return token;
}

async function getGithubUser(token){
   let user = {};
   await fetch(`https://api.github.com/user`, {
      method: 'GET',
      headers: {
         'Authorization': `Bearer ${token}`
      }
   }).then((response) => {
      return response.json()
   }).then((data) => {
      consoleLog("user", data)
      user = data;
   }).catch((error) => {
      console.error('Error:', error);
   })
   return user;
}
async function getLinkedinUser(token){
    let user = {};
    await fetch(`https://api.linkedin.com/v2/userinfo`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    }).then((response) => {
        return response.json()
    }).then((data) => {
        //consoleLog("user", data)
        user = data;
    }).catch((error) => {
        console.error('Error:', error);
    })
    return user;
}