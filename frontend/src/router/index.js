import { createRouter, createWebHistory } from 'vue-router';
import Home from '../views/Home.vue';
import ReimbList from '../views/ReimbList.vue';
import ReimbCreate from '../views/ReimbCreate.vue';
import ReimbDetail from '../views/ReimbDetail.vue';
import ApproveList from '../views/ApproveList.vue';
import ProjectDashboard from '../views/ProjectDashboard.vue';
import Reports from '../views/Reports.vue';
import Profile from '../views/Profile.vue';
import RoleAdmin from '../views/RoleAdmin.vue';
import MyProjects from '../views/MyProjects.vue';
import ProjectMembers from '../views/ProjectMembers.vue';

const router = createRouter({
  history: createWebHistory('/h5/'),
  routes: [
    { path: '/', name: 'home', component: Home, meta: { title: '首页' } },
    { path: '/reimb', name: 'reimb-list', component: ReimbList, meta: { title: '我的报销' } },
    { path: '/reimb/create', name: 'reimb-create', component: ReimbCreate, meta: { title: '新建报销' } },
    { path: '/reimb/:id', name: 'reimb-detail', component: ReimbDetail, meta: { title: '报销详情' } },
    { path: '/approve', name: 'approve-list', component: ApproveList, meta: { title: '待办审批' } },
    { path: '/projects/:id/dashboard', name: 'project-dashboard', component: ProjectDashboard, meta: { title: '项目看板' } },
    { path: '/reports', name: 'reports', component: Reports, meta: { title: '数据总览' } },
    { path: '/admin/roles', name: 'role-admin', component: RoleAdmin, meta: { title: '角色分配' } },
    { path: '/admin/members', name: 'project-members', component: ProjectMembers, meta: { title: '项目成员' } },
    { path: '/my-projects', name: 'my-projects', component: MyProjects, meta: { title: '我的项目组' } },
    { path: '/profile', name: 'profile', component: Profile, meta: { title: '我的' } },
  ],
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 园林协作报销` : '园林协作报销';
});

export default router;
