// Cria contas demo: cliente, motoboy e admin.
import bcrypt from 'bcryptjs';
import { Users } from './db.js';

const demo = [
  { email:'cliente@leva.com', senha:'123456', role:'cliente', nome:'Carla Souza', genero:'f', telefone:'(19) 99999-0001', cpf:'111.111.111-11' },
  { email:'motoboy@leva.com', senha:'123456', role:'motoboy', nome:'Motoboy Demo', genero:'m', telefone:'(19) 99999-0002', cpf:'222.222.222-22', placa:'ABC1D23', modelo:'Honda CG 160', cnh:'01234567890' },
  { email:'admin@leva.com', senha:'admin123', role:'admin', nome:'Admin LEVA', genero:'n', telefone:'(19) 99999-0003', cpf:'333.333.333-33' },
];

for (const d of demo) {
  if (Users.get.get(d.email)) { console.log('já existe:', d.email); continue; }
  Users.insert.run({
    email:d.email, nome:d.nome, telefone:d.telefone, cpf:d.cpf, genero:d.genero, role:d.role,
    senha_hash: bcrypt.hashSync(d.senha, 10),
    placa:d.placa||null, modelo:d.modelo||null, cnh:d.cnh||null,
    created_at: new Date().toISOString(),
  });
  console.log('criado:', d.email, '/', d.senha, `(${d.role})`);
}
console.log('seed ok');
