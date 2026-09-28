<?php

use Illuminate\Support\Facades\Broadcast;
use App\Models\User;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (int) $user->id === (int) $id;
});

Broadcast::channel('staff.orders', function (User $user) {
    return in_array($user->role, [User::ROLE_ADMIN, User::ROLE_STAFF], true);
});
